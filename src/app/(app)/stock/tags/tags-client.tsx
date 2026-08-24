"use client";

// The occasions, as a list.
//
// A night is a thing now rather than a label on a movement: you make one, open
// it, and register against it. So it needs a place to be listed, and the list's
// job is to get somebody into the right one — the pub they ran last night is
// almost always the top row.
//
// What it says about a night is its arithmetic, because there is nothing else
// to say. There is no status: an occasion is never closed and never finished,
// and "still out" is not a state it is in but a fact about its figures — what
// went out that has not come home yet, which is also what its sold figure is
// currently counting. The row says so plainly rather than dressing it as a
// workflow step.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { EmptyNote } from "@/components/ui/empty-state";
import { useTableControls } from "@/lib/data/use-list-query";
import type { StockTagDto } from "@/lib/data/stock";
import { EventDialog } from "./event-dialog";

const kr = (ore: number) =>
  `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(ore / 100)} kr`;

export default function StockTagsClient({
  tags,
  canManage,
}: {
  tags: StockTagDto[];
  canManage: boolean;
}) {
  const t = useTranslations("stock");
  const controls = useTableControls();
  const [making, setMaking] = useState(false);

  const columns: Column<StockTagDto>[] = [
    {
      key: "name",
      header: t("tag.col.name"),
      value: (e) => e.name,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (e) => <span className="font-medium">{e.name}</span>,
    },
    {
      key: "date",
      header: t("tag.col.date"),
      value: (e) => e.date,
      sortable: true,
      searchable: true,
      mobile: "meta",
      className: "tabular-nums",
      cell: (e) => e.date,
    },
    {
      key: "products",
      header: t("tag.col.products"),
      align: "right",
      className: "tabular-nums",
      value: (e) => e.products,
      sortable: true,
      mobile: "meta",
      cell: (e) =>
        e.products === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          t("counts.products", { count: e.products })
        ),
    },
    {
      key: "state",
      header: "",
      align: "right",
      mobile: "meta",
      cell: (e) =>
        e.unreturned ? (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
            {t("tag.stillOut")}
          </span>
        ) : null,
    },
    {
      key: "sold",
      header: t("tag.col.soldValue"),
      align: "right",
      className: "tabular-nums",
      value: (e) => e.soldValueOre,
      sortable: true,
      mobile: "trailing",
      cell: (e) =>
        e.soldValueOre > 0 ? kr(e.soldValueOre) : <span className="text-muted">—</span>,
    },
  ];

  return (
    <PageShell title={t("tag.title")} description={t("tag.description")} width="wide">
      <Card>
        <CardHeader
          title={t("tag.occasions")}
          subtitle={t("tag.counts", { count: tags.length })}
        />
        <ClientDataTable
          columns={columns}
          rows={tags}
          controls={controls}
          rowKey={(e) => e.id}
          rowHref={(e) => `/stock/tags/${e.id}`}
          searchPlaceholder={t("tag.search")}
          action={
            canManage ? <Button onClick={() => setMaking(true)}>{t("tag.new")}</Button> : undefined
          }
          empty={<EmptyNote>{t("tag.empty")}</EmptyNote>}
        />
      </Card>

      {making && <EventDialog onClose={() => setMaking(false)} />}
    </PageShell>
  );
}
