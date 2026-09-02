"use client";

// The stock: one list of what the bar keeps, and what is on the shelf of it.
//
// It used to be two screens. This one grouped products by drink type and showed
// what was on hand; Lagerprodukter listed the same products, searchable, and
// carried the actions. Two answers to "what have we got" is a pair that drifts,
// and the moment a product got a page of its own the split had nothing left to
// justify it, so they are one list now, and what you do to a product you do on
// the product.
//
// A list, not a dashboard: search, the drink type as a filter, and a row that
// opens the thing it names. What needs attention is said on the row rather than
// gathered into a banner, because a warning away from its subject has to name
// it and then be kept in step with it.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ClientDataTable, type ClientSelectFilter } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/field";
import { IconBox, IconPlus, IconSync } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/icon-button";
import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { Notice } from "@/components/ui/notice";
import { useTableControls } from "@/lib/data/use-list-query";
import type { StockLevelDto } from "@/lib/data/stock";
import type { Check } from "@/lib/stock/expiry";
import { alcoholPerKrona, unitVolume } from "@/lib/stock/onhand";
import { hasTag, tagsInUse } from "@/lib/stock/tags";
import { TagChips } from "@/components/stock/tag-chips";
import { ProductDialog } from "./product-dialog";
import { CATEGORIES } from "@/lib/domain/categories";
import { cn } from "@/lib/ui/utils";

const kr = (ore: number) =>
  `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(ore / 100)} kr`;

const litres = (ml: number) =>
  new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    ml / 1000,
  );

const clPerKrona = (cl: number) =>
  new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    cl,
  );

export default function StockClient({
  levels,
  checks,
  asOf,
  today,
  canManage,
}: {
  levels: StockLevelDto[];
  /**
   * Which products want somebody to go and read a crate, by product id.
   *
   * Keyed rather than folded into the level, because it answers a different
   * question from the rest of the row: everything else here is what the shelf
   * holds on the date being looked at, and a check is a thing to do this week.
   * See lib/stock/expiry.ts.
   */
  checks: Record<string, Check>;
  /** The day the figures are as of, when it is not today. */
  asOf?: string;
  /** Today, in Stockholm, decided by the server. See the page. */
  today: string;
  canManage: boolean;
}) {
  const t = useTranslations("stock");
  const router = useRouter();
  const controls = useTableControls();
  const confirm = useConfirm();
  const notify = useNotify();
  const { pending, mutate } = useMutation();
  const [adding, setAdding] = useState(false);

  /**
   * Read every product's log forward again.
   *
   * For the two things a write cannot settle by itself: a valuation rule that
   * has changed since the rows were written, and rows written before there was
   * a rule at all. It is asked for rather than run on a schedule because it
   * rewrites stored figures, and it says what it did afterwards because a
   * maintenance action that reports nothing is one nobody can tell worked.
   */
  async function revalue() {
    const ok = await confirm({
      title: t("revalue.title"),
      message: t("revalue.description"),
      confirmLabel: t("revalue.action"),
    });
    if (!ok) return;
    const done = await mutate<{ products: number; rows: number; beforeOre: number; afterOre: number }>(
      "/api/stock/revalue",
      { key: "revalue", error: t("revalue.failed") },
    );
    if (!done) return;
    notify.success(
      done.rows === 0
        ? t("revalue.settled")
        : t("revalue.done", {
            rows: done.rows,
            products: done.products,
            before: kr(done.beforeOre),
            after: kr(done.afterOre),
          }),
    );
  }

  /**
   * The date lives in the URL, not in state. See the page.
   *
   * Today carries no parameter. The field always shows a day, because a date
   * box reading nothing invites the question "as of when, then?", but asking
   * for today is asking for the ordinary page, so the address stays clean, the
   * query stays unfiltered, and the notice about looking at the past does not
   * fire for the present.
   */
  const setDate = (value: string) =>
    router.push(!value || value === today ? "/stock" : `/stock?date=${value}`);

  // Moving average cost across the whole shelf, summed from the rows the list
  // is drawn from, so a total and its parts cannot disagree.
  const totalValueOre = levels.reduce((sum, l) => sum + l.onHand.valueOre, 0);
  const needsAttention = levels.filter((l) => l.impossible).length;

  // Every tag anything on the shelf carries. The picker in the product dialog
  // offers them, and the filter below narrows by them.
  const tags = tagsInUse(levels);

  /**
   * Two dimensions, narrowed at once: what kind of drink, and what the cellar
   * has labelled it. Picking within one is an "or" (Öl or Vin), picking across
   * them is an "and" (a spirit that is also a whisky).
   *
   * The values are prefixed because the two filters share one list of picks,
   * in the state and in the address, and a tag someone types called "OL" would
   * otherwise be the same string as the drink type.
   */
  const filters: ClientSelectFilter<StockLevelDto>[] = [
    {
      label: t("filterCategory"),
      options: CATEGORIES.map((c) => ({
        value: `cat:${c}`,
        label: t(`category.${c}`),
        predicate: (p: StockLevelDto) => p.category === c,
      })),
    },
    // Only where something is actually due. A filter that can only ever return
    // nothing is a control that reads as broken, the same reason the tag filter
    // below waits for a tag.
    ...(Object.keys(checks).length > 0
      ? [
          {
            label: t("expiry.filter"),
            options: [
              {
                value: "check:any",
                label: t("expiry.filterDue"),
                predicate: (p: StockLevelDto) => checks[p.id] !== undefined,
              },
              {
                value: "check:over",
                label: t("expiry.filterOver"),
                predicate: (p: StockLevelDto) => checks[p.id]?.state === "over",
              },
            ],
          },
        ]
      : []),
    // Nothing to offer until something is tagged, and an empty dropdown is a
    // control that reads as broken.
    ...(tags.length > 0
      ? [
          {
            label: t("filterTag"),
            options: tags.map((tag) => ({
              value: `tag:${tag}`,
              label: tag,
              predicate: (p: StockLevelDto) => hasTag(p.tags, tag),
            })),
          },
        ]
      : []),
  ];

  const columns: Column<StockLevelDto>[] = [
    {
      key: "name",
      header: t("products.col.name"),
      value: (p) => p.name,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (p) => (
        <span className="font-medium">{p.name}</span>
      ),
    },
    {
      // What one of them holds: a bottle's nominal size or a can's, whichever
      // the product is counted in. Not the same question as the litres column
      // further right: that one is the shelf, this one is the thing on it, and
      // it is the column somebody scanning the list for "the 33 or the 50"
      // reads. Through unitVolume so the list and the product page pick the
      // field the same way, including a recorded 0 meaning nobody has said.
      key: "size",
      header: t("products.col.size"),
      align: "right",
      className: "tabular-nums",
      value: (p) => unitVolume(p) ?? -1,
      sortable: true,
      mobile: "meta",
      cell: (p) => {
        const ml = unitVolume(p);
        return ml == null ? <span className="text-muted">–</span> : t("ml", { ml });
      },
    },
    {
      // What a krona buys of this bottle, in pure alcohol: the ratio somebody
      // reaches for when two products look similar on the shelf but are not
      // similar in what they cost per drop. A fact about the product itself,
      // worked out from its own size and cost price, so it sits with size
      // rather than with the value column further right, which is what the
      // *whole* shelf of it is worth today.
      key: "alcoholPerKrona",
      header: t("products.col.alcoholPerKrona"),
      align: "right",
      className: "tabular-nums",
      value: (p) => alcoholPerKrona(p) ?? -1,
      sortable: true,
      mobile: "hide",
      cell: (p) => {
        const cl = alcoholPerKrona(p);
        return cl == null ? (
          <span className="text-muted">–</span>
        ) : (
          t("clPerKrona", { cl: clPerKrona(cl) })
        );
      },
    },
    {
      key: "category",
      header: t("products.col.category"),
      // Searchable on the translated name, so typing "starköl" finds it rather
      // than only the enum nobody sees.
      value: (p) => t(`category.${p.category}`),
      sortable: true,
      searchable: true,
      mobile: "meta",
      cell: (p) => t(`category.${p.category}`),
    },
    {
      key: "tags",
      header: t("products.col.tags"),
      // Searchable, so the box at the top of the list finds a whisky by the
      // word on it and not only by the name of the bottle. Not sortable: a list
      // of labels has no order anybody would be looking for.
      value: (p) => p.tags.join(" "),
      searchable: true,
      mobile: "meta",
      cell: (p) =>
        p.tags.length === 0 ? <span className="text-muted">–</span> : <TagChips tags={p.tags} />,
    },
    {
      key: "onHand",
      header: t("products.col.onHand"),
      align: "right",
      className: "tabular-nums",
      value: (p) => p.onHand.units,
      sortable: true,
      mobile: "meta",
      cell: (p) =>
        p.kind === "VOLUME"
          ? t("holding.volume", { sealed: p.onHand.units, open: p.onHand.openBottles })
          : t("holding.unit", { units: p.onHand.units }),
    },
    {
      key: "litres",
      header: t("products.col.litres"),
      align: "right",
      className: "tabular-nums",
      value: (p) => p.onHand.totalMl ?? -1,
      sortable: true,
      mobile: "hide",
      cell: (p) =>
        p.onHand.totalMl == null ? (
          <span className="text-muted">–</span>
        ) : (
          t("litres", { litres: litres(p.onHand.totalMl) })
        ),
    },
    {
      key: "value",
      header: t("products.col.value"),
      align: "right",
      className: "tabular-nums",
      value: (p) => p.onHand.valueOre,
      sortable: true,
      // Opposite the name on a card: what the shelf is worth is the figure
      // somebody opened this for.
      mobile: "trailing",
      cell: (p) =>
        p.onHand.valueOre > 0 ? kr(p.onHand.valueOre) : <span className="text-muted">–</span>,
    },
    {
      key: "flags",
      header: "",
      align: "right",
      mobile: "meta",
      // Said on the row rather than gathered into a banner, which is this
      // page's whole rule: a warning away from its subject has to name it and
      // then be kept in step with it.
      //
      // The wording is careful, because the app does not know a real date and
      // must not sound as if it does. Nothing is written on a crate here. What
      // it knows is that a delivery from March exists and the product keeps
      // nine months, so what it says is "go and look", not "this has expired".
      cell: (p) => {
        const check = checks[p.id];
        return (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {p.impossible && (
              <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
                {t("flag.impossible")}
              </span>
            )}
            {check && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  check.state === "over"
                    ? "bg-warning-soft text-warning"
                    : "bg-surface text-muted",
                )}
                title={t("expiry.rowHint", {
                  date: check.bestBefore,
                  delivered: check.occurredAt,
                })}
              >
                {check.state === "over"
                  ? t("expiry.flagOver")
                  : t("expiry.flagSoon", { days: check.daysLeft })}
              </span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <PageShell title={t("title")} description={t("description")} width="wide">
      <Card>
        <CardHeader
          title={t("products.onShelf")}
          subtitle={t("counts.products", { count: levels.length })}
          action={
            // The figure the page exists to produce, given its own corner
            // rather than a clause at the end of a subtitle, and the date it
            // is true on standing next to it, because a stock value with no day
            // attached is only meaningful while you are looking at it.
            // A caption over a body of the same height in both, so the two
            // labels sit on one line and the figure sits level with the field
            // beside it. The height is the sm control's, from CONTROL_SIZES,
            // 44px on a phone and 36 from sm up, stated in both bands here so
            // the pair cannot drift apart.
            <div className="flex items-start gap-4">
              <div className="flex flex-col">
                <label
                  htmlFor="stock-as-of"
                  className="text-xs uppercase tracking-wide text-muted"
                >
                  {t("asOf.label")}
                </label>
                <div className="mt-1 w-36">
                  <DateInput
                    id="stock-as-of"
                    size="sm"
                    value={asOf ?? today}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col text-right">
                <span className="text-xs uppercase tracking-wide text-muted">
                  {t("asOf.value")}
                </span>
                <div className="mt-1 flex h-11 items-center justify-end gap-2 sm:h-9">
                  <span className="text-lg font-semibold tabular-nums">{kr(totalValueOre)}</span>
                  {/* Beside the figure it repairs, which is the only place it
                      means anything. It cannot re-price the shelf: every row
                      carries the cost it was booked at, so this can only settle
                      what the rules already imply. See the route. */}
                  {canManage && (
                    <IconButton
                      label={t("revalue.action")}
                      title={t("revalue.action")}
                      loading={pending === "revalue"}
                      onClick={revalue}
                    >
                      <IconSync className="size-4" />
                    </IconButton>
                  )}
                </div>
              </div>
            </div>
          }
        />
        <ClientDataTable
          columns={columns}
          rows={levels}
          controls={controls}
          filter={filters}
          rowKey={(p) => p.id}
          // The row opens the product. Everything you can do to one lives
          // there, so this list carries no buttons of its own beyond adding.
          rowHref={(p) => `/stock/${p.id}`}
          searchPlaceholder={t("products.search")}
          action={
            canManage ? (
              // Two buttons, so on a phone they take half the row each rather
              // than huddling at its left end. The toolbar stretches whatever
              // it is handed; this says how to divide what it gets.
              //
              // `flex-wrap`, because half a row is not always enough of one. A
              // button's label is `whitespace-nowrap`, so "Registrera leverans"
              // beside "Ny produkt" has a min-content width of about 340px and
              // `flex-1` cannot take it below that: on a 360px phone the pair
              // ran off the side of the card. Wrapped they are two full-width
              // buttons, which is what a phone wanted from them anyway.
              <div className="flex flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
                {/* A pallet's worth of deliveries, on its own screen. It sits
                    beside "new product" rather than on a product because that
                    is what it is not about: a delivery of twenty things found
                    one at a time in this list is twenty dialogs, which is the
                    whole reason the sheet exists. */}
                <ButtonLink variant="secondary" href="/stock/delivery">
                  <IconBox className="size-4" />
                  {t("delivery.open")}
                </ButtonLink>
                <Button onClick={() => setAdding(true)}>
                  <IconPlus className="size-4" />
                  {t("products.new")}
                </Button>
              </div>
            ) : undefined
          }
          empty={t("empty.description")}
        />
      </Card>

      {/* Said once, plainly. Every figure on the page is a different number
          from the one it shows by default, and nothing else about the layout
          gives that away. */}
      {asOf && (
        <Notice tone="info">
          {t("asOf.notice", { date: asOf })}{" "}
          <button
            type="button"
            onClick={() => setDate("")}
            className="font-medium underline"
          >
            {t("asOf.today")}
          </button>
        </Notice>
      )}

      {needsAttention > 0 && (
        <p className="text-sm text-warning">{t("attention", { count: needsAttention })}</p>
      )}

      {adding && (
        <ProductDialog product={null} knownTags={tags} onClose={() => setAdding(false)} />
      )}
    </PageShell>
  );
}
