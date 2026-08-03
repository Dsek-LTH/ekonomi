"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tag } from "@/components/ui/status-pill";
import { IconUpload, IconTrash } from "@/components/ui/icons";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { useTableControls } from "@/components/ui/table-controls";
import { useRole } from "@/components/shell/role-context";
import { canBookkeep } from "@/lib/domain/permissions";
import { useNotify } from "@/components/shell/notifications";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import {
  bankAmountColumn,
  bankDateColumn,
  bankDescriptionColumn,
  bankHolderColumn,
} from "@/components/bank-columns";
import { useFormat } from "@/lib/ui/use-format";
import type { BankTransaction } from "@/lib/domain/types";

export default function BankClient({
  bankTransactions,
}: {
  bankTransactions: BankTransaction[];
}) {
  const t = useTranslations("bank");
  const { user } = useRole();
  const { date } = useFormat();
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const fileRef = useRef<HTMLInputElement>(null);

  const controls = useTableControls();
  const canImport = canBookkeep(user.roles);
  const importing = pending === "import";

  const tabs: TabFilter<BankTransaction> = [
    { value: "ALL", label: t("tab.all") },
    { value: "MATCHED", label: t("tab.matched"), predicate: (tx) => !!tx.matchedExpenseId },
    { value: "UNMATCHED", label: t("tab.unmatched"), predicate: (tx) => !tx.matchedExpenseId },
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
    notify.success(parts.join(" · "), t("importDone"));
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

  const totalMatched = bankTransactions.filter((tx) => tx.matchedExpenseId).length;

  const columns: Column<BankTransaction>[] = [
    bankDateColumn(t("colDate"), date),
    bankDescriptionColumn(t("colTransaction")),
    bankHolderColumn(t("colHolder")),
    {
      key: "status",
      header: t("colStatus"),
      cell: (tx) => (
        <Tag tone={tx.matchedExpenseId ? "success" : "neutral"}>
          {tx.matchedExpenseId ? t("matchedWith", { id: tx.matchedExpenseId }) : t("unmatched")}
        </Tag>
      ),
    },
    bankAmountColumn(t("colAmount")),
    {
      key: "actions",
      header: "",
      align: "center",
      hidden: !canImport,
      mobile: "actions",
      cell: (tx) => (
        <IconButton
          tone="danger"
          onClick={() => deleteTxn(tx.id)}
          loading={pending === tx.id}
          label={tx.matchedExpenseId ? t("deleteBlocked") : t("delete")}
        >
          <IconTrash className="size-4" />
        </IconButton>
      ),
    },
  ];

  return (
    <PageShell
      title={t("title")}
      description={t("description")}
    >
      {/* Transaction list */}
      <Card>
        <CardHeader
          title={t("transactions")}
          subtitle={t("matchedCount", { matched: totalMatched, total: bankTransactions.length })}
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

              <Button
                size="sm"
                loading={importing}
                onClick={() => fileRef.current?.click()}
              >
                <IconUpload className="size-4" />
                {t("pickCsv")}
              </Button>
            </>
          )}
        />

        <DataTable
          columns={columns}
          rows={bankTransactions}
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
