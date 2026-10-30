"use client";

// The lagerbokföring itself: every movement, newest first.
//
// This is the screen an inspection is shown and the screen anybody opens when a
// figure looks wrong, so it says more than a list normally would. Both dates
// are on the row: the day it happened and the day it was written down,
// because the gap between them is exactly what gets asked about, and a row that
// showed only one could not answer it.
//
// Read-only, and that is a decision rather than an omission. Registering used
// to happen here, in a panel above the rows, from a sheet that carried its own
// copy of which event and which direction it was for. All of that now lives
// on the event itself (/stock/events/[id]), where the three directions are
// three columns of one grid and the event is the page rather than a picker,
// and a delivery or a stocktake belongs to a product rather than to a night, so
// those live on the product. Two ways to write the same movement is a pair that
// drifts.
//
// Drawn with the app's table rather than a hand-rolled one, so it gets the card
// rendering on a phone, the sortable headers and the search for free. What it
// does *not* get from the table is its filters: which product, which kind and
// which dates are narrowed on the server and live in the URL, because this is
// the screen people send each other links to.
import { IconChart, IconList } from "@/components/ui/icons";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { HISTORY_PATH, historyHref, type HistoryView } from "../history/views";
import { Card } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { MultiCombobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/field";
import { useTableControls } from "@/lib/data/use-list-query";
import type { StockLevelDto, StockLogRowDto } from "@/lib/data/stock";
import { LEVELS } from "@/lib/stock/levels";
import type { StockEntryKind } from "@/lib/domain/types";
import { formatOreKr, formatSigned } from "@/lib/ui/format";

/** The log is a column of movements, so the direction travels with the figure. */
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
const toneFor = (n: number) =>
  n > 0 ? "text-success" : n < 0 ? "text-foreground" : "text-muted";

/** A row's effect on the open bottles, as "80 % → 40 %" or "+ 60 %". Written
 *  out rather than as four numbers, because what a reader wants from the column
 *  is which bottle moved where. */
function levelSummary(open: Record<number, number>): string {
  const left = LEVELS.filter((l) => (open[l] ?? 0) < 0);
  const arrived = LEVELS.filter((l) => (open[l] ?? 0) > 0);
  const part = (levels: number[]) =>
    levels
      .map((l) => `${Math.abs(open[l] ?? 0) > 1 ? `${Math.abs(open[l] ?? 0)}×` : ""}${l} %`)
      .join(", ");
  if (left.length && arrived.length) return `${part(left)} → ${part(arrived)}`;
  if (left.length) return `− ${part(left)}`;
  if (arrived.length) return `+ ${part(arrived)}`;
  return "";
}

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
  // Opens every night's breakdown at once: an inspection, or somebody
  // reconciling a night by hand. The chevrons answer "what is this line made
  // of"; this answers it for all of them without asking row by row.
  const [showRevisions, setShowRevisions] = useState(false);

  // The filters live in the URL, not in state: the log is the screen people
  // send each other links to, and a filtered view that cannot be linked to is
  // one they have to describe in words instead.
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${HISTORY_PATH}?${next.toString()}`);
  };

  // Several values in one parameter, comma-separated: `?kind=PURCHASE,COUNT`.
  // Repeating the key would work too, but one parameter per filter keeps the
  // address readable, and this is the screen people send each other links to.
  const setMany = (key: string, values: string[]) => setParam(key, values.join(","));

  // On a phone a movement is "what, when, how much" and a chevron; the rung
  // breakdown, the event, who booked it and the note are all `hide`. They
  // are not less true there. The log is the screen an inspection is answered
  // from, but seven labelled lines per row is the table transposed, which is
  // the one shape a narrow screen reads worst. They are a tap away, under the
  // chevron or on the product.
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
          {/* Only when they differ. On the same day it is noise, and it is on
              nearly every row. */}
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
      // A night's line covers up to three directions at once, so it is named
      // by the event instead. What it is made of is under the chevron.
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
      // A spill at a pub keeps its count in its own column, because it must
      // not move the shelf, but it is still a quantity that went somewhere, and
      // a breakage that showed a dash in every column was a row this screen
      // could not explain to an inspection. A write-off in the cellar needs
      // none of that: it took stock off the shelf, so it reads out of `units`
      // like every other removal.
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
            <Link href={`/expenses/${r.expenseId}`} className="text-accent">
              {r.expenseReference ?? t("log.expense")}
            </Link>
          )}
          {r.note && <span className="block">{r.note}</span>}
        </>
      ),
    },
  ];

  return (
    // No back link: the log is one of Lager's tabs, not a page under Produkter,
    // and with one it was drawn as a page under the tabs, with its own title.
    <PageShell
      title={t("log.title")}
      width="wide"
      // The other view of the same history, for the same period. See
      // ../history/views.ts.
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
        {/* No header of its own: the tab above says this is the log, and the
            table's footer counts its rows. The narrowing rides the table's
            toolbar beside the search, where every list in the app keeps its
            own controls, so it reads as one bar with the search. */}
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
              {/* Several at a time. Narrowing a log is usually a matter of
                  picking the two beers that matter, or everything except
                  stocktakes, which a one-at-a-time picker turns into as many
                  passes as there are things you care about. */}
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
                  options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
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
          // A night's line is a sum of up to three directions and, for a
          // spirit, of several rungs. This is what it is made of.
          expansion={(r) => (r.parts?.length ? <Parts row={r} /> : null)}
          expandAll={showRevisions}
          empty={t("log.empty")}
        />
      </Card>
    </PageShell>
  );
}

/**
 * One of the two date filters.
 *
 * The masked input reports every keystroke, and each one that happened to be a
 * whole date would navigate. So it keeps what is typed and commits only what
 * the URL can use: a complete date, or nothing.
 *
 * Compact, its label written inside it as the placeholder, the way the table's
 * own date range is, to sit on the toolbar in one line with the search and the
 * two comboboxes.
 */
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
  // A date arriving from the URL (the back button, a shared link) wins over
  // what is half-typed here, which is nothing anybody would miss. During the
  // render rather than in an effect, so the field is never once painted with
  // the previous filter's date.
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

/**
 * What a night's line is made of.
 *
 * The line above says what the product did across the whole event, which is
 * what somebody glancing at the log wants. This is the movements behind it,
 * out, back, spilled, and for a spirit which rung each was, because that is
 * what somebody who stopped to look is asking.
 *
 * Who did any of it is not here on purpose. That is the event's own feed,
 * where a night reads in order rather than a product at a time.
 */
function Parts({ row }: { row: StockLogRowDto }) {
  const t = useTranslations("stock");
  return (
    <ul className="divide-y divide-border/60 py-1 text-xs">
      {row.parts?.map((part) => (
        <li
          key={`${part.kind}-${part.level}`}
          className="flex items-baseline gap-3 py-1.5"
        >
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
