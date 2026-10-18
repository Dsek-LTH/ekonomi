"use client";

// Who did what, in order.
//
// The other half of the stock record, and deliberately a separate half. The log
// says what the stock did: one line per event and product, netted, because
// that is what somebody glancing at it wants. This says who made it say that,
// including the things that turned out not to have happened at all: a beer
// booked against the wrong product and taken off again leaves no movement, and
// should not, but somebody may still need to know it was done.
//
// Read two ways from one table. On an event it is the night in order; on a
// product it is that product's whole story, deliveries included, which is
// where "why does Fireball say 20?" gets asked, and a delivery has no event
// to ask it from. The middle column is whichever of the two the page is not
// already about, so a row never repeats its own heading back at you.
//
// Drawn with the app's table rather than a list, because the questions asked of
// it are a table's questions: everything one person did, everything that
// happened to one product, the day something changed. Search and sorting come
// with it.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import type { StockChangeDto } from "@/lib/data/stock";
import { cn } from "@/lib/ui/utils";

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );

export function ChangeFeed({
  changes,
  /** Which side the reader is on, so the row does not repeat what the page says. */
  scope,
  /** What an empty feed should say, which differs by what it was asked for. */
  empty,
}: {
  changes: StockChangeDto[];
  scope: "event" | "product";
  empty?: string;
}) {
  const t = useTranslations("stock");
  const controls = useTableControls();

  /** What the cell was called: the direction, and the rung when there is one. */
  const named = (c: StockChangeDto) =>
    c.level === 0
      ? t(`kind.${c.kind}`)
      : `${t(`kind.${c.kind}`)} – ${t("event.level.rung", { level: c.level })}`;

  const columns: Column<StockChangeDto>[] = [
    {
      key: "at",
      header: t("changes.col.at"),
      className: "tabular-nums whitespace-nowrap",
      value: (c) => c.at,
      sortable: true,
      mobile: "meta",
      mobileOrder: 1,
      cell: (c) => stamp(c.at),
    },
    {
      key: "actor",
      header: t("changes.col.actor"),
      value: (c) => c.actorName,
      sortable: true,
      searchable: true,
      mobile: "meta",
      cell: (c) => c.actorName,
    },
    {
      // On an event this names the product; on a product it names the
      // event, or says the change was made in the cellar rather than at a
      // night. Either way it is the thing the page is not already about.
      key: "subject",
      header: scope === "event" ? t("changes.col.product") : t("changes.col.event"),
      value: (c) => (scope === "event" ? c.productName : (c.tagName ?? "")),
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (c) =>
        scope === "event" ? (
          <Link href={`/stock/${c.productId}`} className="font-medium hover:underline">
            {c.productName}
          </Link>
        ) : c.eventId ? (
          <Link href={`/stock/events/${c.eventId}`} className="font-medium hover:underline">
            {c.tagName}
          </Link>
        ) : (
          <span className="text-muted">{t("changes.inTheCellar")}</span>
        ),
    },
    {
      key: "what",
      header: t("changes.col.what"),
      className: "text-muted",
      value: named,
      sortable: true,
      searchable: true,
      mobile: "status",
      cell: named,
    },
    {
      key: "change",
      header: t("changes.col.change"),
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      mobile: "trailing",
      // Always both sides of it. A cell that was never set started at nought
      // and one that was removed ended there. The row going away is how the
      // ledger stores "no movement", not something the reader has to be told in
      // different words. So 0 → 1 and 1 → 0, and every change reads the same.
      cell: (c) => {
        const from = c.fromQty ?? 0;
        const to = c.toQty ?? 0;
        return (
          <>
            <span className="text-muted">{from} → </span>
            <span className={cn("font-medium", to === 0 && "text-muted")}>{to}</span>
          </>
        );
      },
    },
  ];

  return (
    <ClientDataTable
      columns={columns}
      rows={changes}
      controls={controls}
      rowKey={(c) => c.id}
      searchPlaceholder={t("changes.search")}
      empty={empty ?? t("changes.none")}
    />
  );
}
