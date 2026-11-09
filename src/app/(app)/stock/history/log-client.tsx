"use client";

// The lagerbokföring itself: every movement, newest first. Read-only: registering lives on the event (/stock/events/[id]) and the product.
// Both dates are on the row, the day it happened and the day it was written down, since the gap is what gets asked about.
// Filters (product, kind, dates) are narrowed on the server and live in the URL.
import { IconChart, IconList } from "@/components/ui/icons";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { HISTORY_PATH, historyHref, type HistoryView } from "./views";
import { Card } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { MultiCombobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/field";
import { useTableControls } from "@/lib/data/use-list-query";
import type { StockLevelDto, StockLogRowDto } from "@/lib/data/stock";
import { levelSummary } from "@/lib/stock/levels";
import type { StockEntryKind } from "@/lib/domain/types";
import { formatOreKr, formatSigned } from "@/lib/ui/format";

const formatOreKrSigned = (ore: number) => formatOreKr(ore, { sign: true });

const KINDS: StockEntryKind[] = [
  "PURCHASE",
  "CHECKOUT",
  "RETURN",
  "WASTE",
  "SPOILAGE",
  "COUNT",
  "CORRECTION",
];

/** Colour carries direction, not kind: in is in, whatever it was called. */
const toneFor = (n: number) => (n > 0 ? "text-success" : n < 0 ? "text-foreground" : "text-muted");

export default function StockLogClient({
  log,
  products,
  filter,
}: {
  log: StockLogRowDto[];
  products: StockLevelDto[];
  filter: {
    productIds: string[];
    kinds: StockEntryKind[];
    eventId?: string;
    from?: string;
    to?: string;
  };
}) {
  const t = useTranslations("stock");
  const router = useRouter();
  const params = useSearchParams();
  const controls = useTableControls();
  // Opens every night's breakdown at once, for reconciling a night by hand.
  const [showRevisions, setShowRevisions] = useState(false);

  // The filters live in the URL, not state, so a filtered view can be linked.
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${HISTORY_PATH}?${next.toString()}`);
  };

  // Several values in one comma-separated parameter: `?kind=PURCHASE,COUNT`.
  const setMany = (key: string, values: string[]) => setParam(key, values.join(","));

  // On a phone a movement is "what, when, how much" and a chevron. The rest is `hide` (a tap away): seven labelled lines per row reads worst on a narrow screen.
  const columns: Column<StockLogRowDto>[] = [
    {
      key: "date",
      header: t("log.col.date"),
      className: "tabular-nums whitespace-nowrap",
      value: (r) => r.occurredAt,
      sortable: true,
      mobile: "meta",
      mobileOrder: 1,
      mobileCell: (r) => r.occurredAt,
      cell: (r) => (
        <>
          {r.occurredAt}
          {r.recordedAt !== r.occurredAt && (
            <span className="block text-xs text-muted">
              {t("log.recorded", { date: r.recordedAt })}
            </span>
          )}
        </>
      ),
    },
    {
      key: "product",
      header: t("log.col.product"),
      value: (r) => r.productName,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (r) => (
        <Link href={`/stock/${r.productId}`} className="font-medium hover:underline">
          {r.productName}
        </Link>
      ),
    },
    {
      key: "kind",
      header: t("log.col.kind"),
      value: (r) => (r.kind ? t(`kind.${r.kind}`) : t("log.duringTheNight")),
      sortable: true,
      searchable: true,
      mobile: "meta",
      // A night's line covers up to three directions, so it is named by the event instead.
      cell: (r) =>
        r.kind ? (
          t(`kind.${r.kind}`)
        ) : (
          <span className="text-muted">{t("log.duringTheNight")}</span>
        ),
    },
    {
      key: "units",
      header: t("log.col.units"),
      align: "right",
      className: "tabular-nums",
      mobile: "status",
      // A pub spill keeps its count in its own column, since it must not move the shelf. A cellar write-off took stock off the shelf, so it reads out of `units` like any removal.
      cell: (r) => {
        const n = r.kind === "WASTE" ? -r.spilledQty : r.units;
        return n === 0 ? (
          <span className="text-muted">-</span>
        ) : (
          <span className={toneFor(n)}>{formatSigned(n)}</span>
        );
      },
      value: (r) => (r.kind === "WASTE" ? -r.spilledQty : r.units),
      sortable: true,
    },
    {
      key: "open",
      header: t("log.col.open"),
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      mobile: "hide",
      cell: (r) => levelSummary(r.open) || <span className="text-muted">-</span>,
    },
    {
      key: "value",
      header: t("log.col.value"),
      align: "right",
      className: "tabular-nums",
      mobile: "trailing",
      cell: (r) =>
        r.valueDeltaOre === 0 ? (
          <span className="text-muted">-</span>
        ) : (
          <span className={toneFor(r.valueDeltaOre)}>{formatOreKrSigned(r.valueDeltaOre)}</span>
        ),
    },
    {
      key: "event",
      header: t("log.col.event"),
      value: (r) => r.tagName ?? "",
      sortable: true,
      searchable: true,
      mobile: "hide",
      cell: (r) =>
        r.eventId ? (
          <Link href={`/stock/events/${r.eventId}`} className="hover:underline">
            {r.tagName}
          </Link>
        ) : (
          <span className="text-muted">-</span>
        ),
    },
    {
      key: "actor",
      header: t("log.col.actor"),
      className: "text-muted",
      value: (r) => r.actorName,
      sortable: true,
      searchable: true,
      mobile: "hide",
      cell: (r) => r.actorName,
    },
    {
      key: "note",
      header: t("log.col.note"),
      className: "text-muted",
      searchable: true,
      value: (r) => r.note ?? "",
      mobile: "hide",
      cell: (r) => (
        <>
          {r.expenseId && (
            <Link href={`/expenses/${r.expenseId}`} className="text-link">
              {r.expenseReference ?? t("log.expense")}
            </Link>
          )}
          {r.note && <span className="block">{r.note}</span>}
        </>
      ),
    },
  ];

  return (
    // No back link: the log is one of Lager's tabs.
    <PageShell
      title={t("log.title")}
      width="wide"
      // The other view of the same history, same period (../history/views.ts).
      views={{
        label: t("history.viewLabel"),
        value: "movements",
        options: [
          { value: "movements", label: t("history.movements"), icon: IconList },
          { value: "stats", label: t("history.stats"), icon: IconChart },
        ],
        onChange: (v) => router.push(historyHref(v as HistoryView, filter.from, filter.to)),
      }}
    >
      <Card>
        {/* No header: the tab above names the log. Filters ride the table's toolbar beside the search. */}
        <ClientDataTable
          columns={columns}
          rows={log}
          controls={controls}
          rowKey={(r) => r.id}
          searchPlaceholder={t("log.searchPlaceholder")}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-11 items-center gap-2 text-sm text-muted sm:h-8">
                <Checkbox
                  checked={showRevisions}
                  onChange={() => setShowRevisions((on) => !on)}
                  label={t("log.showRevisions")}
                />
                {t("log.showRevisions")}
              </span>
              {/* Several at a time, so "everything except stocktakes" is one pass. */}
              <div className="min-w-[12rem]">
                <MultiCombobox
                  size="sm"
                  values={filter.productIds}
                  onChange={(v) => setMany("product", v)}
                  options={products.map((p) => ({ value: p.id, label: p.name }))}
                  placeholder={t("log.filter.allProducts")}
                  searchPlaceholder={t("log.filter.searchProduct")}
                  clearLabel={t("log.filter.allProducts")}
                  aria-label={t("log.filter.product")}
                />
              </div>
              <div className="min-w-[9rem]">
                <MultiCombobox
                  size="sm"
                  values={filter.kinds}
                  onChange={(v) => setMany("kind", v)}
                  options={KINDS.map((k) => ({
                    value: k,
                    label: t(`kind.${k}`),
                  }))}
                  placeholder={t("log.filter.allKinds")}
                  clearLabel={t("log.filter.allKinds")}
                  aria-label={t("log.filter.kind")}
                />
              </div>
              <span className="flex items-center gap-2">
                <DateFilter
                  label={t("log.filter.from")}
                  value={filter.from ?? ""}
                  onCommit={(v) => setParam("from", v)}
                />
                <span className="text-xs text-muted">-</span>
                <DateFilter
                  label={t("log.filter.to")}
                  value={filter.to ?? ""}
                  onCommit={(v) => setParam("to", v)}
                />
              </span>
            </div>
          }
          // What a night's line is made of: up to three directions and, for a spirit, several rungs.
          expansion={(r) => (r.parts?.length ? <Parts row={r} /> : null)}
          expandAll={showRevisions}
          empty={t("log.empty")}
        />
      </Card>
    </PageShell>
  );
}

/** One of the two date filters. The masked input reports every keystroke, so it keeps what is typed and commits only a complete date or nothing. */
function DateFilter({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [typed, setTyped] = useState(value);
  // A date arriving from the URL wins over a half-typed one, adjusted during render so the field never paints the previous filter's date.
  const [fromUrl, setFromUrl] = useState(value);
  if (fromUrl !== value) {
    setFromUrl(value);
    setTyped(value);
  }

  return (
    <span className="w-32">
      <DateInput
        size="sm"
        value={typed}
        placeholder={label}
        aria-label={label}
        onChange={(e) => {
          const next = e.target.value;
          setTyped(next);
          if (next === "" || /^\d{4}-\d{2}-\d{2}$/.test(next)) onCommit(next);
        }}
      />
    </span>
  );
}

/** What a night's line is made of: the movements behind it (out, back, spilled, and the rung for a spirit). Who did it is the event's own feed. */
function Parts({ row }: { row: StockLogRowDto }) {
  const t = useTranslations("stock");
  return (
    <ul className="divide-y divide-border/60 py-1 text-xs">
      {row.parts?.map((part) => (
        <li key={`${part.kind}-${part.level}`} className="flex items-baseline gap-3 py-1.5">
          <span className="w-16 shrink-0 font-medium">
            {part.kind === "COUNT" ? t("log.counted") : t(`kind.${part.kind}`)}
          </span>
          <span className="w-20 shrink-0 text-muted">
            {row.productKind === "VOLUME"
              ? part.level === 0
                ? t("event.level.sealed")
                : t("event.level.rung", { level: part.level })
              : ""}
          </span>
          <span className="tabular-nums">{part.qty}</span>
        </li>
      ))}
    </ul>
  );
}
