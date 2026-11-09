"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { InfoHint } from "@/components/ui/info-hint";
import { IconChevronDown, IconUpload, IconTrash } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/tooltip";
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
import { cn } from "@/lib/ui/utils";
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
  unaccounted,
  placesCards,
  viewerId,
}: {
  page: RowPage<BankTransaction>;
  scope: BankScope;
  scopes: BankScope[];
  cards: SectionCard[];
  /** The whole card register, for the card picker. Empty for anybody the server does not let assign one, which also decides whether the picker is drawn. */
  allCards: SectionCard[];
  /** Purchases on no card (the section's reading). "Utan kort" is a tab only while above zero. */
  cardless: number;
  unaccounted: number;
  /** Whether placing the cardless ones is the reader's job (their count is work waiting, not a tally; a revisor sees them too). */
  placesCards: boolean;
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
  // The no-card list holds every row it will have, so it narrows in the browser.
  const canImport = canBookkeep(user.capabilities);
  // The register is only sent to somebody who may write it, so having one is the permission.
  const canAssign = allCards.length > 0;
  const importing = pending === "import";

  // Reminders for unaccounted card purchases: tick, then "Påminn" (see useReminderPicks). Main
  // list only, since a purchase on no card has no holder to remind.
  const picks = useReminderPicks({
    rows: page.rows,
    enabled: canSendReminders(user.capabilities),
    subject: "transaction",
    rowId: (tx) => tx.id,
    remindable: (tx) => canRemindAboutTransaction(tx, viewerId),
    rowLabel: (tx) => `${date(tx.transactionDate)} ${tx.description}`,
  });

  // In the URL like other list filters; the server reads the same parameter (see useScopeSwitch).
  const setScope = useScopeSwitch(controls.tab, (s) => bankDefaultTab(s as BankScope));

  // Stage, named for who acts next. "Utan kort" only on the section's reading and only while
  // there is one (docs/navigation.md). The tab is a server filter (getBankTransactionPage), so
  // it is always passed since the default differs per scope (bankDefaultTab).
  const tabs: TabFilter = BANK_TABS.filter((v) => v !== "nocard" || cardless > 0).map((value) => ({
    value,
    label: t(`tab.${value}`),
    badge:
      value === "nocard"
        ? cardless
        : value === "unaccounted"
          ? unaccounted || undefined
          : undefined,
    waiting: value === "nocard" ? placesCards : value === "unaccounted",
  }));

  async function upload(file: File) {
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

  // An empty pick means "off every card": a row on the wrong card must be able to come off. It
  // answers whether it took, so the cell can revert its optimistic holder.
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
    // Whose card it sat on, or (when all are yours) which of your cards, once somebody holds several.
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
    // Also offers "Redovisa" where there is no utlägg yet and the purchase is the viewer's own.
    // On a phone it rides in the card's action row, with the matched utlägg's number as a link.
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
      // Not on a phone, where the row's one button is "Redovisa". Delete is a desk task.
      mobile: "hide",
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

  // On a phone the picker stands opposite the second line (cardless rows have no holder name).
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
      <Card>
        <DataTable
          columns={[picks.column, ...(controls.tab === "nocard" ? cardlessColumns : columns)]}
          rows={page.rows}
          controls={controls}
          tabs={tabs}

          action={
            canImport && (
              <>
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
            )
          }
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(tx) => tx.id}
          empty={t("noMatch")}
        />
      </Card>

      {picks.bar}
      {picks.dialog}
    </PageShell>
  );
}

/**
 * Which card a purchase sat on, as something bookkeeping can set. The import places a row
 * only when the Referens ended in a K#### token; the rest have no card and never reach the
 * purchaser's feed.
 */

/** The box a card holder sits in: the picker's shape from md (176px), so names and the "Välj kort" picker line up. */
const CARD_BOX =
  "flex w-full min-w-0 items-center gap-1.5 rounded-control border md:h-8 md:w-44 md:px-2.5";

function CardCell({
  tx,
  cards,
  busy,
  onPick,
}: {
  tx: BankTransaction;
  cards: SectionCard[];
  busy: boolean;
  onPick: (cardId: string) => Promise<boolean>;
}) {
  const t = useTranslations("bank");
  // A row with no card opens as the picker (that is the work); one with a card reads as text
  // until clicked.
  const [picking, setPicking] = useState(false);
  // The card just picked, shown at once since the write and re-render take two round trips.
  // Dropped if the server refuses it.
  const [picked, setPicked] = useState<string | null>(null);

  async function pick(cardId: string) {
    setPicked(cardId);
    // Clearing puts the row back on no card, so that picker stays open.
    setPicking(cardId === "");
    if (await onPick(cardId)) return;
    setPicked(null);
    setPicking(true);
  }

  const card = picked ? cards.find((c) => c.id === picked) : undefined;
  const row: BankTransaction = card
    ? {
        ...tx,
        cardId: card.id,
        cardLast4: card.last4,
        cardHolderId: card.holderId,
        cardHolderName: card.holderName,
      }
    : picked === ""
      ? {
          ...tx,
          cardId: undefined,
          cardLast4: undefined,
          cardHolderId: undefined,
          cardHolderName: undefined,
        }
      : tx;

  // The server refuses to move the card under a matched purchase (a match is only between an
  // utlägg and its submitter's own card), so it is not offered. Hover text, no chevron.
  if (tx.matchedExpenseId) {
    return (
      <Tooltip label={t("cardLocked")} align="start" className="w-full md:w-44">
        <span className={cn(CARD_BOX, "border-transparent")}>
          <BankCardHolder tx={tx} />
          <span className="sr-only">{t("cardLocked")}</span>
        </span>
      </Tooltip>
    );
  }

  // A picker at rest: name and number with a faint chevron (always, since a phone has no hover).
  if (row.cardLast4 && !picking) {
    return (
      <Tooltip label={t("changeCard")} align="start" className="w-full md:w-44">
        <button
          type="button"
          onClick={() => setPicking(true)}
          className={cn(
            CARD_BOX,
            "border-transparent text-left transition-colors hover:border-border-control hover:bg-background",
          )}
        >
          <span className="min-w-0 flex-1">
            <BankCardHolder tx={row} />
          </span>
          <IconChevronDown aria-hidden className="size-4 shrink-0 text-faint" />
          <span className="sr-only">{t("changeCard")}</span>
        </button>
      </Tooltip>
    );
  }

  return (
    <Combobox
      size="sm"
      className="md:w-44"
      // On a phone a word opposite the row's second line: a 44px control overlapped the rows.
      buttonClassName="md:h-8 md:rounded-control md:border md:border-border-control md:bg-background md:px-2.5"
      chevronClassName="text-accent md:text-faint"
      allowClear
      disabled={busy}
      value={row.cardId ?? ""}
      onChange={pick}
      placeholder={t("assignCard")}
      aria-label={t("assignCard")}
      // Shutting the list without a pick puts the name back; a row on no card keeps its picker.
      openOnMount={picking}
      onClose={() => {
        if (row.cardLast4) setPicking(false);
      }}
      // Carries the number (what the bank wrote) and the holder (who it means); the number
      // alone on a trigger too narrow for the name.
      options={cards.map((c) => ({
        value: c.id,
        label: c.holderName ? `····${c.last4} - ${c.holderName}` : `····${c.last4}`,
        short: `····${c.last4}`,
      }))}
    />
  );
}
