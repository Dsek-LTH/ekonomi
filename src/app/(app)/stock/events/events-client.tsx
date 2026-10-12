"use client";

// The events, as a list.
//
// A night is a thing now rather than a label on a movement: you make one, open
// it, and register against it. So it needs a place to be listed, and the list's
// job is to get somebody into the right one: the pub they ran last night is
// almost always the top row.
//
// What it says about a night is its arithmetic, because there is nothing else
// to say. There is no status: an event is never closed and never finished, and
// nothing here can say whether a night is done. The row used to carry a "still
// out" badge that meant to, but its condition was `out > back + spilled`, which
// is the definition of the sold figure standing beside it, so it lit on every
// night that sold anything. Telling the two apart needs something the log does
// not record.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import type { StockEventDto } from "@/lib/data/stock";
import { EventDialog } from "./event-dialog";
import { formatOreKr } from "@/lib/ui/format";

export default function EventsClient({
  events,
  canManage,
}: {
  events: StockEventDto[];
  canManage: boolean;
}) {
  const t = useTranslations("stock");
  const controls = useTableControls();
  const [making, setMaking] = useState(false);

  const columns: Column<StockEventDto>[] = [
    {
      key: "name",
      header: t("event.col.name"),
      value: (e) => e.name,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (e) => <span className="font-medium">{e.name}</span>,
    },
    {
      key: "date",
      header: t("event.col.date"),
      value: (e) => e.date,
      sortable: true,
      searchable: true,
      mobile: "meta",
      className: "tabular-nums",
      cell: (e) => e.date,
    },
    {
      key: "products",
      header: t("event.col.products"),
      align: "right",
      className: "tabular-nums",
      value: (e) => e.products,
      sortable: true,
      mobile: "meta",
      cell: (e) =>
        e.products === 0 ? (
          <span className="text-muted">–</span>
        ) : (
          t("counts.products", { count: e.products })
        ),
    },
    {
      key: "sold",
      header: t("event.col.soldValue"),
      align: "right",
      className: "tabular-nums",
      value: (e) => e.soldValueOre,
      sortable: true,
      mobile: "trailing",
      cell: (e) =>
        e.soldValueOre > 0 ? formatOreKr(e.soldValueOre) : <span className="text-muted">–</span>,
    },
  ];

  return (
    <PageShell title={t("event.title")} width="wide">
      <Card>
        <CardHeader
          title={t("event.listTitle")}
          subtitle={t("event.counts", { count: events.length })}
        />
        <ClientDataTable
          columns={columns}
          rows={events}
          controls={controls}
          rowKey={(e) => e.id}
          rowHref={(e) => `/stock/events/${e.id}`}
          searchPlaceholder={t("event.search")}
          action={
            canManage ? <Button onClick={() => setMaking(true)}>{t("event.new")}</Button> : undefined
          }
          empty={t("event.empty")}
        />
      </Card>

      {making && <EventDialog onClose={() => setMaking(false)} />}
    </PageShell>
  );
}
