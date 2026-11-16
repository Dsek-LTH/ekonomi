"use client";

// Fakturering: one row per person with a tab, what they owe, and the year-end run. A row opens that person's tab.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { PageShell } from "@/components/page-shell";
import { Amount } from "@/components/ui/amount";
import { UserAvatar } from "@/components/ui/avatar";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { IconPlus } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import type { BoardMemberDto } from "@/lib/data/board";
import { useTableControls } from "@/lib/data/use-list-query";
import type { BoardInvoicePreview } from "@/lib/server/board-invoices";

import { kronor } from "../tab-view";
import { InvoiceDialog } from "./invoice-dialog";

export default function InvoicesClient({
  members,
  invoices,
  yearLabel,
  canManage,
}: {
  /** Everybody with a tab. */
  members: BoardMemberDto[];
  /** What the year-end run would invoice, and has, per member. */
  invoices: BoardInvoicePreview[];
  /** The räkenskapsår picked in the header, which is the year the invoices are for. */
  yearLabel: string | null;
  /** The treasurer: may log for anybody and invoice. */
  canManage: boolean;
}) {
  const t = useTranslations("board");
  // Who owes the most first.
  const controls = useTableControls({ sortKey: "owed", sortDir: "desc" });
  /** The year-end run's preview. Null while shut. */
  const [invoicing, setInvoicing] = useState<BoardInvoicePreview[] | null>(null);
  const toInvoice = invoices.filter(
    (m) => m.lines.length > 0 || m.invoices.some((i) => !i.documentNumber),
  );
  const owed = members.reduce((sum, m) => sum + m.uninvoicedOre, 0);

  const columns: Column<BoardMemberDto>[] = [
    {
      key: "member",
      header: t("members.col.member"),
      value: (m) => m.name,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (m) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <UserAvatar userId={m.id} name={m.name} size="sm" />
          <span className="truncate font-medium">{m.name}</span>
        </span>
      ),
      mobileCell: (m) => m.name,
    },
    {
      key: "status",
      header: t("members.col.status"),
      value: (m) => (m.onBoard ? 0 : 1),
      mobile: "status",
      cell: (m) => (m.onBoard ? null : <Tag tone="warning">{t("members.left")}</Tag>),
    },
    {
      key: "count",
      header: t("members.col.count"),
      align: "right",
      className: "tabular-nums",
      value: (m) => m.uninvoicedCount,
      sortable: true,
      mobile: "meta",
      cell: (m) => t("members.count", { count: m.uninvoicedCount }),
    },
    {
      key: "owed",
      header: t("members.col.owed"),
      align: "right",
      value: (m) => m.uninvoicedOre,
      sortable: true,
      mobile: "trailing",
      cell: (m) => (
        <Amount
          value={kronor(m.uninvoicedOre)}
          className={m.uninvoicedOre === 0 ? "font-normal text-muted" : undefined}
        />
      ),
    },
  ];

  return (
    <PageShell title={t("invoices.title")} width="content">
      <Card>
        <ClientDataTable
          columns={columns}
          rows={members}
          controls={controls}
          rowKey={(m) => m.id}
          rowHref={(m) => `/board/invoices/${m.id}`}
          searchPlaceholder={t("members.search")}
          summary={
            <>
              <span className="text-muted">{t("members.total")}</span>
              <Amount value={kronor(owed)} />
            </>
          }
          action={
            canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <ButtonLink size="sm" variant="secondary" href="/board">
                  <IconPlus className="size-4" />
                  {t("invoices.logFor")}
                </ButtonLink>
                {yearLabel && (
                  <Button
                    size="sm"
                    disabled={toInvoice.length === 0}
                    onClick={() => setInvoicing(toInvoice)}
                  >
                    {t("invoice.all", { year: yearLabel })}
                  </Button>
                )}
              </div>
            )
          }
          empty={t("members.none")}
        />
      </Card>

      {invoicing && yearLabel && (
        <InvoiceDialog year={yearLabel} members={invoicing} onClose={() => setInvoicing(null)} />
      )}
    </PageShell>
  );
}
