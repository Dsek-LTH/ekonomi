"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { InfoHint } from "@/components/ui/info-hint";
import { IconUpload, IconTrash } from "@/components/ui/icons";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { useScopeSwitch, useUrlTableControls } from "@/lib/data/use-list-query";
import { useRole } from "@/components/shell/role-context";
import { canBookkeep, canSendReminders } from "@/lib/domain/permissions";
import { canRemindAboutTransaction } from "@/lib/domain/reminders";
import { useReminderPicks } from "@/components/reminder-picks";
import { useNotify } from "@/components/shell/notifications";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import {
  BankCardHolder,
  bankAmountColumn,
  bankCardColumn,
  bankDateColumn,
  bankDescriptionColumn,
  bankHolderColumn,
  bankMatchedColumn,
} from "@/components/columns/bank-columns";
import { Combobox } from "@/components/ui/combobox";
import type { PatchBankTransaction } from "@/lib/api/schemas/bank";
import { useFormat } from "@/lib/ui/use-format";
import type { RowPage } from "@/lib/data/list-query";
import type { BankTransaction, Card as SectionCard } from "@/lib/domain/types";
import { BANK_TABS, bankDefaultTab, type BankScope } from "./scope";

export default function BankClient({
  page,
  scope,
  scopes,
  cards,
  allCards,
  cardless,
  viewerId,
}: {
  page: RowPage<BankTransaction>;
  /** Settled on the server, see page.tsx. Never decided here. */
  scope: BankScope;
  /** The scopes this reader may pick between, in track order. */
  scopes: BankScope[];
  /** The reader's own cards, to decide whether the card column earns its width. */
  cards: SectionCard[];
  /**
   * The whole card register, for the picker in the card column. Empty for
   * anybody the server does not let assign one, which is what decides whether
   * the picker is drawn at all: an empty list here is not a short menu, it is
   * "not yours to change".
   */
  allCards: SectionCard[];
  /** The purchases on no card. Empty for anybody who cannot place them. */
  /** Purchases on no card, on the section's reading. "Utan kort" is a tab
   *  only while this is above zero. */
  cardless: number;
  viewerId: string;
}) {
  const t = useTranslations("bank");
  const { user } = useRole();
  const { date } = useFormat();
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const fileRef = useRef<HTMLInputElement>(null);

  const controls = useUrlTableControls(page.total, bankDefaultTab(scope));
  // The no-card list is every row it will ever hold, so it narrows in the
  // browser and keeps its state here rather than in the address, which is the
  // main list's.
  const canImport = canBookkeep(user.capabilities);
  // The register is only sent to somebody the server would let write it, so
  // having one is the permission (see page.tsx).
  const canAssign = allCards.length > 0;
  const importing = pending === "import";

  // Chasing card purchases nobody has accounted for: tick them, then
  // "Påminn", and each holder gets one mail listing theirs. Only the main
  // list. A purchase on no card has no holder to remind, which is the job the
  // no-card table is for. See useReminderPicks.
  const picks = useReminderPicks({
    rows: page.rows,
    enabled: canSendReminders(user.capabilities),
    subject: "transaction",
    rowId: (tx) => tx.id,
    remindable: (tx) => canRemindAboutTransaction(tx, viewerId),
    rowLabel: (tx) => `${date(tx.transactionDate)} ${tx.description}`,
  });

  // In the URL, like every other filter on a list: which purchases you were
  // looking at is a thing people send each other, and it is the same parameter
  // the server reads to decide what to fetch. See useScopeSwitch.
  const setScope = useScopeSwitch(controls.tab, (s) => bankDefaultTab(s as BankScope));

  // Stage, named for who acts next. "Utan kort" only on the section's reading
  // and only while there is one: those purchases are on nobody's own feed, and
  // placing them is bookkeeping's. It used to be a notice with a second table
  // under it, because as a tab it sat empty most of the time. A tab that is
  // hidden when empty has no such cost (see docs/navigation.md).
  //
  // No predicates. The tab is a filter the server applies (see
  // getBankTransactionPage), so the rows arrive already narrowed to it. The
  // default differs per scope, so it is always passed (see bankDefaultTab).
  const tabs: TabFilter = BANK_TABS.filter((v) => v !== "nocard" || cardless > 0).map((value) => ({
    value,
    label: t(`tab.${value}`),
    badge: value === "nocard" ? cardless : undefined,
  }));



  async function upload(file: File) {
    // The CSV is posted as-is; only the summary line is ours to build.
    const data = await mutate("/api/bank/import", {
      key: "import",
      body: file,
      contentType: "text/csv",
      error: t("importFailed"),
    });
    if (fileRef.current) fileRef.current.value = "";
    if (!data) return;
    const count = (key: string) => Number(data[key]) || 0;
    const counts: [number, string][] = [
      [count("imported"), "imported"],
      [count("skipped"), "duplicates"],
      [count("cardsCreated"), "newCards"],
      [count("skippedRows"), "skippedRows"],
    ];
    // Everything but the import count is only worth a line when it happened.
    const parts = counts
      .filter(([n], i) => i === 0 || n > 0)
      .map(([n, key]) => t(`summary.${key}`, { count: n }));
    notify.success(parts.join(" - "), t("importDone"));
  }

  async function deleteTxn(id: string) {
    const ok = await confirm({
      title: t("deleteTitle"),
      message: t("deleteMessage"),
      confirmLabel: t("deleteConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/bank/${id}`, {
      key: id,
      method: "DELETE",
      error: t("deleteFailed"),
    });
  }

  // An empty pick means "off every card", which is a real answer: a row put on
  // the wrong card has to be able to come off it again.
  //
  // Answers whether it took, because the cell shows the picked holder before
  // the server has confirmed it and has to put that back if it did not.
  async function assignCard(txId: string, cardId: string): Promise<boolean> {
    const body: PatchBankTransaction = { cardId: cardId || null };
    const res = await mutate(`/api/bank/${txId}`, {
      key: `card-${txId}`,
      method: "PATCH",
      body,
      error: t("assignFailed"),
    });
    return res !== null;
  }

  const columns: Column<BankTransaction>[] = [
    bankDateColumn(t("colDate"), date),
    bankDescriptionColumn(t("colTransaction")),
    // Whose card it sat on, or (when they are all yours) which of your cards.
    // The second only earns its width once somebody holds more than one.
    scope !== "mine"
      ? bankHolderColumn(
          t("colHolder"),
          canAssign
            ? (tx) => (
                <CardCell
                  tx={tx}
                  cards={allCards}
                  busy={pending === `card-${tx.id}`}
                  onPick={(cardId) => assignCard(tx.id, cardId)}
                />
              )
            : undefined,
        )
      : bankCardColumn(t("colCard"), cards.length <= 1),
    bankAmountColumn(t("colAmount")),
    // Was a status pill saying "Matchad - DEK26-0039". It said the same thing
    // this does, in more words and without going anywhere, and the tabs above
    // already sort matched from unmatched, which is the only part a pill was
    // adding. Same column as on Kortköp, so the two tables answer "which
    // utlägg" the same way.
    //
    // The same column offers "Redovisa" where there is no utlägg yet and the
    // purchase is the viewer's own: has this been dealt with is one question,
    // and the link and the button are its two answers. They were two columns,
    // one of them empty on every row the other was not. "Redovisa" used to
    // exist only on Kortköp, which meant a treasurer looking at the section's
    // feed found their own unaccounted purchase and could not do the one thing
    // they wanted to it.
    //
    // On a phone it rides in the card's action row rather than its line of
    // details, because a button cannot sit in a line of small text. The
    // matched utlägg's number goes with it and reads there as the link it is.
    {
      ...bankMatchedColumn(t("colExpense"), {
        linked: t("matched"),
        unmatched: (tx) =>
          tx.cardHolderId === viewerId ? (
            <ButtonLink href={`/expenses/new?txn=${tx.id}`} size="sm">
              <IconUpload className="size-4" />
              {t("account")}
            </ButtonLink>
          ) : null,
      }),
      mobile: "actions",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      // Not on a phone, where the row's one button is "Redovisa". Deleting a
      // bank row is a treasurer's tidying, done at a desk.
      mobile: "hide",
      // Only the delete now, so only for someone who may delete.
      hidden: !canImport,
      cell: (tx) => (
        <span className="flex items-center justify-end gap-1">
          {canImport && (
            <IconButton
              tone="danger"
              onClick={() => deleteTxn(tx.id)}
              loading={pending === tx.id}
              label={tx.matchedExpenseId ? t("deleteBlocked") : t("delete")}
            >
              <IconTrash className="size-4" />
            </IconButton>
          )}
        </span>
      ),
    },
  ];

  // The cardless rows are there to be put on a card, so on a phone the picker
  // stands opposite the second line rather than the holder's name being in it,
  // which these rows do not have.
  const cardlessColumns = columns.map((c) =>
    c.key === "holder" ? { ...c, mobile: "status" as const, mobileCell: undefined } : c,
  );

  return (
    <PageShell
      title={t("title")}
      collections={
        scopes.length > 1
          ? {
              label: t("scopeLabel"),
              value: scope,
              onChange: setScope,
              options: scopes.map((s) => ({ value: s, label: t(`scope.${s}`) })),
            }
          : undefined
      }
    >
      {/* Transaction list */}
      <Card>
        <DataTable
          columns={[picks.column, ...(controls.tab === "nocard" ? cardlessColumns : columns)]}
          rows={page.rows}
          controls={controls}
          tabs={tabs}
          // On the list's own toolbar, like every other list's action: an
          // import adds rows to what is below it.
          action={(picks.button || canImport) && (
            <>
              {picks.button}
              {canImport && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload(f);
                    }}
                  />

                  <span className="flex items-center gap-1">
                    <Button
                      size="sm"
                      loading={importing}
                      onClick={() => fileRef.current?.click()}
                    >
                      <IconUpload className="size-4" />
                      {t("pickCsv")}
                    </Button>
                    <InfoHint label={t("csvHelp.label")}>
                      <span className="block font-medium text-foreground">
                        {t("csvHelp.title")}
                      </span>
                      <span className="mt-1 block">{t("csvHelp.source")}</span>
                      <span className="mt-1.5 block">{t("csvHelp.format")}</span>
                      <span className="mt-1.5 block">{t("csvHelp.cards")}</span>
                      <span className="mt-1.5 block">{t("csvHelp.duplicates")}</span>
                      <span className="mt-1.5 block">{t("csvHelp.limits")}</span>
                    </InfoHint>
                  </span>
                </>
              )}
            </>
          )}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(tx) => tx.id}
          empty={t("noMatch")}
        />
      </Card>

      {picks.dialog}
    </PageShell>
  );
}

/**
 * Which card a purchase sat on, as something bookkeeping can set.
 *
 * The import only places a row on a card when the Referens ended in a K####
 * token. The rest arrive on no card at all, which means they never reach the
 * feed of the person who made the purchase, so nobody accounts for them. This
 * is where somebody says whose they were.
 */
function CardCell({
  tx,
  cards,
  busy,
  onPick,
}: {
  tx: BankTransaction;
  cards: SectionCard[];
  busy: boolean;
  /** Whether the write took. See `assignCard`. */
  onPick: (cardId: string) => Promise<boolean>;
}) {
  const t = useTranslations("bank");
  // A row with no card opens as the picker: that is the work, and it is what
  // makes the gaps visible in a list that is mostly not gaps. A row that has a
  // card reads as text until it is clicked, so the section's feed stays a feed
  // rather than a wall of dropdowns.
  const [picking, setPicking] = useState(false);
  // The card just picked, which is who the row belongs to from the moment it
  // was chosen. The write and the re-render behind it are two round trips, and
  // leaving a dropdown on screen for that stretch reads as a pick that did not
  // land. Dropped again if the server refuses it.
  const [picked, setPicked] = useState<string | null>(null);

  async function pick(cardId: string) {
    setPicked(cardId);
    // Clearing puts the row back on no card, which is the state the picker is
    // the display for, so that one stays open.
    setPicking(cardId === "");
    if (await onPick(cardId)) return;
    setPicked(null);
    setPicking(true);
  }

  // The row as the pick leaves it, until the refreshed one carries the same
  // thing. Same shape either way, so the cell has one thing to draw.
  const card = picked ? cards.find((c) => c.id === picked) : undefined;
  const row: BankTransaction =
    card ? { ...tx, cardId: card.id, cardLast4: card.last4, cardHolderId: card.holderId, cardHolderName: card.holderName }
    : picked === "" ? { ...tx, cardId: undefined, cardLast4: undefined, cardHolderId: undefined, cardHolderName: undefined }
    : tx;

  // The server refuses to move the card under a matched purchase: a match is
  // only allowed between an utlägg and its submitter's own card, so the match
  // has to come off first. Better not to offer it than to offer it and refuse.
  if (tx.matchedExpenseId) return <BankCardHolder tx={tx} />;

  if (row.cardLast4 && !picking) {
    return (
      <button
        type="button"
        onClick={() => setPicking(true)}
        title={t("changeCard")}
        className="text-left hover:text-accent"
      >
        <BankCardHolder tx={row} />
      </button>
    );
  }

  return (
    <Combobox
      size="sm"
      className="md:w-44"
      // On a phone a word opposite the row's second line rather than a field:
      // a 44px control there overlapped the rows above and below it. The list
      // it opens is a screen of its own on a phone, so the trigger only has to
      // be something to tap. From md it is the field it always was.
      buttonClassName="md:h-9 md:rounded-control md:border md:border-border md:bg-background md:px-2.5"
      chevronClassName="text-accent md:text-faint"
      allowClear
      disabled={busy}
      value={row.cardId ?? ""}
      onChange={pick}
      placeholder={t("assignCard")}
      aria-label={t("assignCard")}
      // The number is what the bank wrote and the holder is who it means, so
      // the option carries both. Collapsed to the number alone on a trigger too
      // narrow for the name, which is the cell in most tables.
      options={cards.map((c) => ({
        value: c.id,
        label: c.holderName ? `····${c.last4} - ${c.holderName}` : `····${c.last4}`,
        short: `····${c.last4}`,
      }))}
    />
  );
}
