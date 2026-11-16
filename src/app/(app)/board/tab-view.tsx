"use client";

// A member's running tab, drawn the same on Mina uttag and on the treasury's page for one person: the facts strip,
// the open tab (one row per product, opening into when each was taken), and the tabs already invoiced.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { LABEL, StripCell } from "@/components/record-card";
import { useMutation } from "@/components/shell/use-mutation";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { Tag } from "@/components/ui/status-pill";
import type { BoardWithdrawalDto, ClosedTabDto } from "@/lib/data/board";
import { useTableControls } from "@/lib/data/use-list-query";
import { formatOreKr } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";

import { ResendDialog, type ResendOptions } from "./resend-dialog";

export const kr = (ore: number) => formatOreKr(ore, { decimals: 2 });

/** Öre to the kronor `Amount` takes. */
export const kronor = (ore: number) => ore / 100;

/** Takes a withdrawal back, which also takes it out of the stock's log. */
export function useRemoveWithdrawal() {
  const t = useTranslations("board");
  const { pending, mutate } = useMutation();
  return {
    pending,
    run: (w: BoardWithdrawalDto) =>
      mutate(`/api/board/withdrawals/${w.id}`, {
        key: `remove:${w.id}`,
        method: "DELETE",
        error: t("removeFailed"),
        success: t("removed"),
      }),
  };
}

/** What is owed, since when, and how many withdrawals it is, as the record pages' fact strip. */
export function TabFacts({ open }: { open: BoardWithdrawalDto[] }) {
  const t = useTranslations("board.tab");
  const { date } = useFormat();
  const since = open.at(-1)?.date;
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
        <StripCell label={t("owed")} className="col-span-2 sm:col-span-1">
          <Amount value={kronor(open.reduce((sum, w) => sum + w.amountOre, 0))} size="md" />
        </StripCell>
        <StripCell label={t("since")}>{since ? date(since) : "-"}</StripCell>
        <StripCell label={t("count")}>{t("units", { count: open.length })}</StripCell>
      </div>
    </Card>
  );
}

interface ProductLine {
  name: string;
  qty: number;
  amountOre: number;
  /** The last day it was taken. */
  last: string;
  rows: BoardWithdrawalDto[];
}

/** The open tab: one row per product, opening into each time it was taken (where one can be taken back). */
export function OpenTab({
  open,
  mayRemove,
  empty,
  action,
}: {
  /** What is not invoiced yet, newest first. */
  open: BoardWithdrawalDto[];
  mayRemove: (w: BoardWithdrawalDto) => boolean;
  /** Said when nothing is open. */
  empty: string;
  /** The tab's own action, at the end of the card's header. */
  action?: React.ReactNode;
}) {
  const t = useTranslations("board.tab");
  const tb = useTranslations("board");
  const { date } = useFormat();
  const controls = useTableControls({ sortKey: "amount", sortDir: "desc" });
  const remove = useRemoveWithdrawal();

  const lines = [
    ...open
      .reduce((acc, w) => {
        const line = acc.get(w.productName) ?? {
          name: w.productName,
          qty: 0,
          amountOre: 0,
          last: w.date,
          rows: [],
        };
        line.qty += w.qty;
        line.amountOre += w.amountOre;
        line.rows.push(w);
        return acc.set(w.productName, line);
      }, new Map<string, ProductLine>())
      .values(),
  ];

  const columns: Column<ProductLine>[] = [
    {
      key: "product",
      header: t("col.product"),
      value: (l) => l.name,
      sortable: true,
      mobile: "title",
      cell: (l) => <span className="font-medium">{l.name}</span>,
    },
    {
      key: "qty",
      header: t("col.qty"),
      align: "right",
      className: "tabular-nums",
      value: (l) => l.qty,
      sortable: true,
      mobile: "meta",
      cell: (l) => t("units", { count: l.qty }),
    },
    {
      key: "last",
      header: t("col.last"),
      className: "tabular-nums whitespace-nowrap",
      value: (l) => l.last,
      sortable: true,
      mobile: "meta",
      cell: (l) => date(l.last),
    },
    {
      key: "amount",
      header: t("col.amount"),
      align: "right",
      value: (l) => l.amountOre,
      sortable: true,
      mobile: "trailing",
      cell: (l) => <Amount value={kronor(l.amountOre)} />,
    },
  ];

  return (
    <Card>
      {/* The action in the header and no summary, so the table draws no toolbar row: the total is in the fact strip. */}
      <CardHeader title={t("open")} action={action} />
      <ClientDataTable
        columns={columns}
        rows={lines}
        controls={controls}
        rowKey={(l) => l.name}
        // Each time it was taken: the day, who wrote it down, and the way to take it back.
        expansion={(l) => (
          <ul className="divide-y divide-border/60 py-1 text-xs">
            {l.rows.map((w) => (
              <li key={w.id} className="flex min-h-8 items-center gap-3 py-1">
                <span className="w-24 shrink-0 tabular-nums">{date(w.date)}</span>
                <span className="w-12 shrink-0 tabular-nums">{t("units", { count: w.qty })}</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {kr(w.unitPriceOre)}
                  {w.loggedBy && `, ${tb("loggedBy", { name: w.loggedBy })}`}
                </span>
                {mayRemove(w) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={remove.pending === `remove:${w.id}`}
                    onClick={() => remove.run(w)}
                  >
                    {tb("remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        empty={empty}
      />
    </Card>
  );
}

/** The tabs already invoiced, newest first, each opening into its lines. */
export function ClosedTabs({
  closed,
  resend,
}: {
  closed: ClosedTabDto[];
  /** For the treasurer, who may send an invoice that has not reached Fortnox again: what can be picked then. */
  resend?: ResendOptions;
}) {
  const t = useTranslations("board.tab");
  const { date } = useFormat();
  const [resending, setResending] = useState<ClosedTabDto | null>(null);
  const controls = useTableControls({ sortKey: "date", sortDir: "desc" });
  if (closed.length === 0) return null;

  const columns: Column<ClosedTabDto>[] = [
    {
      key: "date",
      header: t("col.date"),
      className: "tabular-nums whitespace-nowrap",
      value: (c) => c.invoiceDate,
      sortable: true,
      mobile: "title",
      cell: (c) => date(c.invoiceDate),
    },
    {
      key: "invoice",
      header: t("col.invoice"),
      className: "tabular-nums whitespace-nowrap",
      value: (c) => c.documentNumber ?? "",
      sortable: true,
      mobile: "meta",
      cell: (c) => c.documentNumber ?? <span className="text-muted">-</span>,
    },
    {
      key: "lines",
      header: t("col.lines"),
      align: "right",
      className: "tabular-nums",
      value: (c) => c.lines.length,
      mobile: "meta",
      cell: (c) => t("lines", { count: c.lines.length }),
    },
    {
      key: "status",
      header: t("col.status"),
      value: (c) => (c.documentNumber ? 1 : 0),
      sortable: true,
      mobile: "status",
      cell: (c) =>
        c.documentNumber ? (
          <Tag tone="success">{t("inFortnox")}</Tag>
        ) : (
          <Tag tone="warning">{t("unconfirmed")}</Tag>
        ),
    },
    {
      key: "amount",
      header: t("col.amount"),
      align: "right",
      value: (c) => c.totalOre,
      sortable: true,
      mobile: "trailing",
      cell: (c) => <Amount value={kronor(c.totalOre)} />,
    },
    ...(resend
      ? [
          {
            key: "actions",
            header: "",
            align: "right",
            mobile: "actions",
            cell: (c) =>
              !c.documentNumber && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResending(c);
                  }}
                >
                  {t("resend")}
                </Button>
              ),
          } satisfies Column<ClosedTabDto>,
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader title={t("closed")} />
      <ClientDataTable
        columns={columns}
        rows={closed}
        controls={controls}
        rowKey={(c) => c.id}
        expansion={(c) => (
          <ul className="divide-y divide-border/60 py-1 text-xs">
            {c.lines.map((l, i) => (
              <li key={i} className="flex items-baseline gap-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{l.description}</span>
                <span className="w-12 tabular-nums">{t("units", { count: l.qty })}</span>
                <span className={`w-20 text-right tabular-nums ${LABEL}`}>
                  {kr(l.unitPriceOre)}
                </span>
                <span className="w-24 text-right font-medium tabular-nums">{kr(l.amountOre)}</span>
              </li>
            ))}
          </ul>
        )}
      />
      {resending && resend && (
        <ResendDialog invoice={resending} options={resend} onClose={() => setResending(null)} />
      )}
    </Card>
  );
}
