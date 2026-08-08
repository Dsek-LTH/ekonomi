"use client";

import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconUpload } from "@/components/ui/icons";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { useUrlTableControls } from "@/lib/data/use-list-query";
import {
  bankAmountColumn,
  bankCardColumn,
  bankDateColumn,
  bankDescriptionColumn,
  bankMatchedColumn,
} from "@/components/columns/bank-columns";
import type { RowPage } from "@/lib/data/list-query";
import type { BankTransaction, Card as SectionCard } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";

/**
 * The tab this page opens on — see APPROVALS_DEFAULT_TAB for why it is declared
 * once and shared rather than written on both sides.
 */
export const CARD_PURCHASES_DEFAULT_TAB = "UNMATCHED";

export default function CardPurchasesClient({
  page,
  cards,
}: {
  page: RowPage<BankTransaction>;
  cards: SectionCard[];
}) {
  const t = useTranslations("cardPurchases");
  const { date } = useFormat();
  const controls = useUrlTableControls(page.total, CARD_PURCHASES_DEFAULT_TAB);

  const tabs: TabFilter = [
    // No predicates — these are filters the server applies; see
    // getBankTransactionPage, which takes the same two names.
    { value: CARD_PURCHASES_DEFAULT_TAB, label: t("tab.unaccounted") },
    { value: "MATCHED", label: t("tab.accounted") },
    { value: "ALL", label: t("tab.all") },
  ];

  // Both props arrive scoped to this member (see page.tsx) — the cards are
  // theirs and the transactions are the ones made on them, so there is nothing
  // left to filter here. Only the card column is a question: it earns its space
  // once someone holds more than one card.
  const showCardCol = cards.length > 1;

  // Already newest-first from the query, and DataTable takes over once a column
  // is sorted — so there is nothing to re-sort here. (The comparator that used
  // to do it never returned 0, so it reordered same-day purchases instead of
  // leaving them alone.)
  const myPurchases = page.rows;

  const columns: Column<BankTransaction>[] = [
    bankDateColumn(t("colDate"), date),
    bankDescriptionColumn(t("colMerchant")),
    bankCardColumn(t("colCard"), !showCardCol),
    bankAmountColumn(t("colAmount")),
    // A purchase already being accounted for, on an utlägg not yet sent in:
    // it has no number to show, but it is the thing the reader is looking for.
    bankMatchedColumn(t("colExpense"), { linked: t("expenseStarted") }),
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      cell: (tx) =>
        !tx.matchedExpenseId && (
          <ButtonLink href={`/expenses/new?txn=${tx.id}`} size="sm">
            <IconUpload className="size-4" />
            {t("account")}
          </ButtonLink>
        ),
    },
  ];

  if (cards.length === 0) {
    return (
      <PageShell title={t("title")} description={t("descriptionShort")} width="content">
        <EmptyState title={t("noCardTitle")} description={t("noCardDescription")} />
      </PageShell>
    );
  }

  return (
    <PageShell
      title={t("title")}
      description={t("description")}
      width="content"
    >
      <Card>
        <DataTable
          columns={columns}
          rows={myPurchases}
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
