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
import { IconBox, IconPlus } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { useTableControls } from "@/lib/data/use-list-query";
import type { StockLevelDto } from "@/lib/data/stock";
import { unitVolume } from "@/lib/stock/onhand";
import { CATEGORIES, ProductDialog } from "./product-dialog";

const kr = (ore: number) =>
  `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(ore / 100)} kr`;

const litres = (ml: number) =>
  new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    ml / 1000,
  );

export default function StockClient({
  levels,
  asOf,
  today,
  canManage,
}: {
  levels: StockLevelDto[];
  /** The day the figures are as of, when it is not today. */
  asOf?: string;
  /** Today, in Stockholm, decided by the server. See the page. */
  today: string;
  canManage: boolean;
}) {
  const t = useTranslations("stock");
  const router = useRouter();
  const controls = useTableControls();
  const [adding, setAdding] = useState(false);

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

  const filter: ClientSelectFilter<StockLevelDto> = {
    label: t("filterCategory"),
    options: CATEGORIES.map((c) => ({
      value: c,
      label: t(`category.${c}`),
      predicate: (p: StockLevelDto) => p.category === c,
    })),
  };

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
      cell: (p) =>
        p.impossible ? (
          <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
            {t("flag.impossible")}
          </span>
        ) : null,
    },
  ];

  return (
    <PageShell title={t("title")} description={t("description")} width="wide">
      <Card>
        <CardHeader
          title={t("products.products")}
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
                <span className="mt-1 flex h-11 items-center justify-end text-lg font-semibold tabular-nums sm:h-9">
                  {kr(totalValueOre)}
                </span>
              </div>
            </div>
          }
        />
        <ClientDataTable
          columns={columns}
          rows={levels}
          controls={controls}
          filter={filter}
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
              <div className="flex items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
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

      {adding && <ProductDialog product={null} onClose={() => setAdding(false)} />}
    </PageShell>
  );
}
