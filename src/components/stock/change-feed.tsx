"use client";

// Who did what, in order: the other half of the stock record. The log says what stock did (netted per event and product),
// this says who made it, including changes that netted to no movement.
// On an event it is the night in order, on a product its whole story including deliveries; the middle column is whichever the page is not about.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import type { StockChangeDto } from "@/lib/data/stock";
import { cn } from "@/lib/ui/utils";
import { useFormat } from "@/lib/ui/use-format";

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
  const { dateTime } = useFormat();

  /** What the cell was called: the direction, and the rung when there is one. */
  const named = (c: StockChangeDto) =>
    c.level === 0
      ? t(`kind.${c.kind}`)
      : `${t(`kind.${c.kind}`)} - ${t("event.level.rung", { level: c.level })}`;

  const columns: Column<StockChangeDto>[] = [
    {
      key: "at",
      header: t("changes.col.at"),
      className: "tabular-nums whitespace-nowrap",
      value: (c) => c.at,
      sortable: true,
      mobile: "meta",
      mobileOrder: 1,
      cell: (c) => dateTime(c.at),
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
      // Names the product on an event, the event (or the cellar) on a product.
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
      // Always both sides: a cell never set started at 0 and a removed one ended there, so every change reads 0 → 1 or 1 → 0.
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
