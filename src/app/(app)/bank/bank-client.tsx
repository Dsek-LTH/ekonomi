"use client";

import { useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { InfoHint } from "@/components/ui/info-hint";
import { IconUpload, IconTrash } from "@/components/ui/icons";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { useUrlTableControls } from "@/lib/data/use-list-query";
import { useRole } from "@/components/shell/role-context";
import { canBookkeep } from "@/lib/domain/permissions";
import { useNotify } from "@/components/shell/notifications";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import {
  bankAmountColumn,
  bankCardColumn,
  bankDateColumn,
  bankDescriptionColumn,
  bankHolderColumn,
  bankMatchedColumn,
} from "@/components/columns/bank-columns";
import { useFormat } from "@/lib/ui/use-format";
import type { RowPage } from "@/lib/data/list-query";
import type { BankTransaction, Card as SectionCard } from "@/lib/domain/types";

/** Whose purchases are being read: the section's, or the reader's own. */
export type BankScope = "mine" | "all";

export default function BankClient({
  page,
  scope,
  canPickScope,
  cards,
  viewerId,
}: {
  page: RowPage<BankTransaction>;
  /** Settled on the server, see page.tsx. Never decided here. */
  scope: BankScope;
  canPickScope: boolean;
  /** The reader's own cards, to decide whether the card column earns its width. */
  cards: SectionCard[];
  viewerId: string;
}) {
  const t = useTranslations("bank");
  const { user } = useRole();
  const { date } = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const fileRef = useRef<HTMLInputElement>(null);

  const controls = useUrlTableControls(page.total, scope === "mine" ? "UNMATCHED" : "ALL");
  const canImport = canBookkeep(user.capabilities);
  const importing = pending === "import";

  // In the URL, like every other filter on a list: which purchases you were
  // looking at is a thing people send each other, and it is the same parameter
  // the server reads to decide what to fetch.
  function setScope(next: string) {
    const q = new URLSearchParams(params.toString());
    q.set("scope", next);
    // The tab defaults differ per scope, and a tab carried across from the
    // other one would leave the address bar describing a filter this scope did
    // not open on. Paging likewise: page 4 of the section's feed is not page 4
    // of your own.
    q.delete("tab");
    q.delete("page");
    router.push(`${pathname}?${q.toString()}`);
  }

  // Unaccounted first, because on either scope it is the only tab with anything
  // to do in it. Which means neither scope may leave the default unstated:
  // DataTable falls back to its first tab, and the server to no filter at all,
  // and the two would describe different lists. See parseListQuery.
  const tabs: TabFilter = [
    // No predicates. The tab is a filter the server applies (see
    // getBankTransactionPage), so the rows arrive already narrowed to it.
    { value: "UNMATCHED", label: t("tab.unmatched") },
    { value: "MATCHED", label: t("tab.matched") },
    { value: "ALL", label: t("tab.all") },
  ];

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
    notify.success(parts.join(" – "), t("importDone"));
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

  const columns: Column<BankTransaction>[] = [
    bankDateColumn(t("colDate"), date),
    bankDescriptionColumn(t("colTransaction")),
    // Whose card it sat on, or (when they are all yours) which of your cards.
    // The second only earns its width once somebody holds more than one.
    scope === "all"
      ? bankHolderColumn(t("colHolder"))
      : bankCardColumn(t("colCard"), cards.length <= 1),
    // Was a status pill saying "Matchad – DEK26-0039". It said the same thing
    // this does, in more words and without going anywhere, and the tabs above
    // already sort matched from unmatched, which is the only part a pill was
    // adding. Same column as on Kortköp, so the two tables answer "which
    // utlägg" the same way.
    bankMatchedColumn(t("colExpense"), { linked: t("matched") }),
    bankAmountColumn(t("colAmount")),
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      // Two actions on one column, and which of them a row offers depends on
      // the row rather than on the page. "Redovisa" used to exist only on
      // Kortköp, which meant a treasurer looking at the section's feed found
      // their own unaccounted purchase and a delete button: the one thing they
      // could not do to it was the thing they wanted.
      cell: (tx) => (
        <span className="flex items-center justify-end gap-1">
          {tx.cardHolderId === viewerId && !tx.matchedExpenseId && (
            <ButtonLink href={`/expenses/new?txn=${tx.id}`} size="sm">
              <IconUpload className="size-4" />
              {t("account")}
            </ButtonLink>
          )}
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

  return (
    <PageShell
      title={t("title")}
      collections={
        canPickScope
          ? {
              label: t("scopeLabel"),
              value: scope,
              onChange: setScope,
              options: [
                { value: "mine", label: t("scope.mine") },
                { value: "all", label: t("scope.all") },
              ],
            }
          : undefined
      }
    >
      {/* Transaction list */}
      <Card>
        <CardHeader
          title={t("transactions")}
          action={canImport && (
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
        />

        <DataTable
          columns={columns}
          rows={page.rows}
          controls={controls}
          tabs={tabs}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(tx) => tx.id}
          empty={t("noMatch")}
        />
      </Card>
    </PageShell>
  );
}
