"use client";

// The stock: one list of what the bar keeps and what is on its shelf. Search, drink type as a filter, a row that opens the product.
// What needs attention is said on the row, not gathered into a banner.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Card } from "@/components/ui/card";
import { ClientDataTable, type ClientSelectFilter } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/field";
import { IconBox, IconList, IconPlus, IconSync } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/icon-button";
import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls } from "@/lib/data/use-list-query";
import type { StockLevelDto } from "@/lib/data/stock";
import type { Check } from "@/lib/stock/expiry";
import { alcoholPerKrona, unitVolume } from "@/lib/stock/onhand";
import { hasTag, tagsInUse } from "@/lib/stock/tags";
import { validGtin } from "@/lib/stock/barcode";

/** A barcode that is there and does not add up. See lib/stock/barcode.ts. */
const badBarcode = (p: { ean?: string | null }) => Boolean(p.ean) && !validGtin(p.ean!);
import { TagChips } from "@/components/stock/tag-chips";
import { CategoryMark } from "@/components/stock/category-mark";
import { BottleLevels } from "@/components/stock/bottle-levels";
import { Menu, MenuItem } from "@/components/ui/menu";
import { ProductDialog } from "./product-dialog";
import { CATEGORIES } from "@/lib/domain/categories";
import { formatClPerKrona, formatLitres, formatOreKr } from "@/lib/ui/format";

export default function StockClient({
  levels,
  checks,
  expiryUnset,
  asOf,
  today,
  canManage,
}: {
  levels: StockLevelDto[];
  /** Which products want somebody to go and read a crate, by product id. Separate from the level: always as of today. See lib/stock/expiry.ts. */
  checks: Record<string, Check>;
  /** The day the figures are as of, when it is not today. */
  asOf?: string;
  /** Today, in Stockholm, decided by the server. See the page. */
  today: string;
  canManage: boolean;
  /** No notice period has been chosen, so no checks are raised at all. */
  expiryUnset: boolean;
}) {
  const t = useTranslations("stock");
  const router = useRouter();
  const controls = useTableControls();
  const confirm = useConfirm();
  const notify = useNotify();
  const { pending, mutate } = useMutation();
  const [adding, setAdding] = useState(false);

  /** Read every product's log forward again, for a changed valuation rule or rows written before one existed. Asked for, since it rewrites stored figures. */
  async function revalue() {
    const ok = await confirm({
      title: t("revalue.title"),
      message: t("revalue.description"),
      confirmLabel: t("revalue.action"),
    });
    if (!ok) return;
    const done = await mutate<{
      products: number;
      rows: number;
      beforeOre: number;
      afterOre: number;
    }>("/api/stock/revalue", { key: "revalue", error: t("revalue.failed") });
    if (!done) return;
    notify.success(
      done.rows === 0
        ? t("revalue.settled")
        : t("revalue.done", {
            rows: done.rows,
            products: done.products,
            before: formatOreKr(done.beforeOre),
            after: formatOreKr(done.afterOre),
          }),
    );
  }

  /** The date lives in the URL, not state. Today carries no parameter, so the address stays clean and the past-date notice does not fire. */
  const setDate = (value: string) =>
    router.push(!value || value === today ? "/stock" : `/stock?date=${value}`);

  // Moving average cost across the whole shelf, summed from the rows the list is drawn from.
  const totalValueOre = levels.reduce((sum, l) => sum + l.onHand.valueOre, 0);
  // A product needs a look when its log does not add up, something may be past its best, or its barcode has a wrong check digit.
  const needsLook = (p: StockLevelDto) =>
    p.impossible || checks[p.id] !== undefined || badBarcode(p);
  const needsAttention = levels.filter(needsLook).length;

  // Every tag on the shelf, for the product dialog's picker and the filter.
  const tags = tagsInUse(levels);

  /**
   * Two dimensions narrowed at once: drink kind and cellar label. Within one is an "or", across them an "and".
   * Values are prefixed since both share one list of picks and a tag "OL" would collide with a drink type.
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
    // Only where something is due: a filter that can only return nothing reads as broken.
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
    // Nothing to offer until something is tagged.
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
      cell: (p) => <span className="font-medium">{p.name}</span>,
      // On a phone the mark goes before the name, since the category column is not on the row there.
      mobileCell: (p) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <CategoryMark category={p.category} />
          <span className="truncate">{p.name}</span>
        </span>
      ),
    },
    {
      // A bottle's nominal size or a can's. Through unitVolume so the list and the product page pick the field the same way (a recorded 0 means nobody has said).
      key: "size",
      header: t("products.col.size"),
      align: "right",
      className: "tabular-nums",
      value: (p) => unitVolume(p) ?? -1,
      sortable: true,
      mobile: "meta",
      cell: (p) => {
        const ml = unitVolume(p);
        return ml == null ? <span className="text-muted">-</span> : t("ml", { ml });
      },
    },
    {
      // What a krona buys of this bottle in pure alcohol, from its own size and cost price (not the shelf's value).
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
          <span className="text-muted">-</span>
        ) : (
          t("clPerKrona", { cl: formatClPerKrona(cl) })
        );
      },
    },
    {
      key: "category",
      header: t("products.col.category"),
      // Searchable on the translated name, so "starköl" finds it.
      value: (p) => t(`category.${p.category}`),
      sortable: true,
      searchable: true,
      // Off a phone's row, where the mark goes before the name instead.
      mobile: "hide",
      // Its mark beside the name (components/stock/category-mark.tsx).
      cell: (p) => (
        <span className="flex items-center gap-2">
          <CategoryMark category={p.category} />
          {t(`category.${p.category}`)}
        </span>
      ),
    },
    {
      key: "tags",
      header: t("products.col.tags"),
      // Searchable so a whisky is found by the word on it. Not sortable.
      value: (p) => p.tags.join(" "),
      searchable: true,
      mobile: "hide",
      cell: (p) =>
        p.tags.length === 0 ? <span className="text-muted">-</span> : <TagChips tags={p.tags} />,
    },
    {
      key: "onHand",
      header: t("products.col.onHand"),
      align: "right",
      className: "tabular-nums",
      value: (p) => p.onHand.units,
      sortable: true,
      mobile: "meta",
      cell: (p) => <BottleLevels kind={p.kind} sealed={p.onHand.units} open={p.onHand.open} />,
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
          <span className="text-muted">-</span>
        ) : (
          t("litres", { litres: formatLitres(p.onHand.totalMl) })
        ),
    },
    {
      key: "value",
      header: t("products.col.value"),
      align: "right",
      className: "tabular-nums",
      value: (p) => p.onHand.valueOre,
      sortable: true,
      mobile: "trailing",
      cell: (p) =>
        p.onHand.valueOre > 0 ? (
          formatOreKr(p.onHand.valueOre)
        ) : (
          <span className="text-muted">-</span>
        ),
    },
    {
      key: "flags",
      header: "",
      align: "right",
      mobile: "status",
      // Said on the row, not in a banner. The app knows no real date, so the wording is "go and look", not "this has expired".
      cell: (p) => {
        const check = checks[p.id];
        return (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {p.impossible && (
              <Tag tone="danger" size="sm">
                {t("flag.impossible")}
              </Tag>
            )}
            {badBarcode(p) && (
              <Tag tone="warning" size="sm" title={t("barcode.invalidHint")}>
                {t("barcode.invalidTag")}
              </Tag>
            )}
            {check && (
              <Tag
                size="sm"
                tone={check.state === "over" ? "warning" : "neutral"}
                title={t("expiry.rowHint", {
                  date: check.bestBefore,
                  delivered: check.occurredAt,
                })}
              >
                {check.state === "over"
                  ? t("expiry.flagOver")
                  : t("expiry.flagSoon", { days: check.daysLeft })}
              </Tag>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <PageShell
      title={t("title")}
      width="wide"
      // The day the whole page is true on, in the header (see PageShell's `view`). The reset sits beside it so there is a way back to today.
      view={
        <div className="flex items-center gap-2">
          <label htmlFor="stock-as-of" className="shrink-0 text-sm text-muted">
            {t("asOf.label")}
          </label>
          <div className="w-40">
            <DateInput
              id="stock-as-of"
              size="sm"
              value={asOf ?? today}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {asOf && (
            <Button
              variant="link"
              type="button"
              onClick={() => setDate("")}
              className="shrink-0 text-sm"
            >
              {t("asOf.today")}
            </Button>
          )}
        </div>
      }
    >
      {expiryUnset && (
        <Notice>
          {t("expiryUnset")}{" "}
          {canManage && (
            <Link href="/admin/stock" className="font-medium underline">
              {t("expiryUnsetAction")}
            </Link>
          )}
        </Notice>
      )}
      <Card>
        <ClientDataTable
          columns={columns}
          rows={levels}
          controls={controls}
          // The work queue beside the whole list; the count is drawn only when there is something in it.
          tabs={[
            { value: "ALL", label: t("tabs.all") },
            {
              value: "ATTENTION",
              label: t("tabs.attention"),
              badge: needsAttention > 0 ? needsAttention : undefined,
              predicate: needsLook,
            },
          ]}
          filter={filters}
          // The sum of the Värde column (that day's value on a past day), beside the rows it totals.
          summary={
            <>
              <span className="text-muted">{t("asOf.value")}</span>
              <span className="font-semibold tabular-nums">{formatOreKr(totalValueOre)}</span>
              {/* Beside the figure it repairs. It cannot re-price the shelf: each row carries the cost it was booked at. See the route. */}
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
            </>
          }
          rowKey={(p) => p.id}
          // The row opens the product; everything you can do to one lives there.
          rowHref={(p) => `/stock/${p.id}`}
          searchPlaceholder={t("products.search")}
          action={
            canManage ? (
              // Two buttons sharing the row on a phone. `flex-wrap` because "Registrera leverans" beside "Ny produkt" has a min-content of about 340px, wider than half a 360px phone.
              <div className="flex flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
                {/* The sheets that write to every product at once, under one "Registrera", beside "new product" because they are not about one product. */}
                <Menu label={t("register.label")} variant="secondary">
                  <MenuItem onClick={() => router.push("/stock/delivery")}>
                    <IconBox className="size-4" />
                    {t("delivery.open")}
                  </MenuItem>
                  <MenuItem onClick={() => router.push("/stock/stocktake")}>
                    <IconList className="size-4" />
                    {t("stocktakeSheet.open")}
                  </MenuItem>
                </Menu>
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

      {adding && <ProductDialog product={null} knownTags={tags} onClose={() => setAdding(false)} />}
    </PageShell>
  );
}
