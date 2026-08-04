"use client";

import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconUpload } from "@/components/ui/icons";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { useTableControls } from "@/components/ui/table-controls";
import { useRole } from "@/components/shell/role-context";
import {
  bankAmountColumn,
  bankCardColumn,
  bankDateColumn,
  bankDescriptionColumn,
  bankMatchedColumn,
} from "@/components/bank-columns";
import type { BankTransaction, Card as SectionCard } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";

export default function CardPurchasesClient({
  bankTransactions,
  cards,
}: {
  bankTransactions: BankTransaction[];
  cards: SectionCard[];
}) {
  const t = useTranslations("cardPurchases");
  const { user } = useRole();
  const { date } = useFormat();
  const controls = useTableControls();

  const tabs: TabFilter<BankTransaction> = [
    { value: "unmatched", label: t("tab.unaccounted"), predicate: (tx) => !tx.matchedExpenseId },
    { value: "matched", label: t("tab.accounted"), predicate: (tx) => !!tx.matchedExpenseId },
    { value: "all", label: t("tab.all") },
  ];

  const myCards = cards.filter((c) => c.holderId === user.id);
  const showCardCol = myCards.length > 1;

  // Already newest-first from the query, and DataTable takes over once a column
  // is sorted — so there is nothing to re-sort here. (The comparator that used
  // to do it never returned 0, so it reordered same-day purchases instead of
  // leaving them alone.)
  const myPurchases = bankTransactions.filter(
    (tx) => tx.cardHolderId === user.id,
  );

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

  if (myCards.length === 0) {
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
