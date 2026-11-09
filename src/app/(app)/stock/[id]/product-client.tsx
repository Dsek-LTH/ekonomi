"use client";

// One product: what is on its shelf (bottle by bottle), then its last movements. Everything done to a product lives here (delivery, stocktake, edit); nightly in/out is done from the log.
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { useConfirm } from "@/components/confirm-dialog";
import { useReturnTo } from "@/components/shell/route-history";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Menu, MenuItem } from "@/components/ui/menu";
import { IconDots, IconPencil, IconTrash } from "@/components/ui/icons";
import { PurchaseDialog, SpoilageDialog, StocktakeDialog } from "../product-actions";
import { BottleLevels } from "@/components/stock/bottle-levels";
import { isInternalCode, validGtin } from "@/lib/stock/barcode";
import { Notice } from "@/components/ui/notice";
import { CategoryMark } from "@/components/stock/category-mark";
import { ProductDialog } from "../product-dialog";
import { TagChips } from "@/components/stock/tag-chips";
import type { CellarRowDto, ProductEventDto, StockLevelDto } from "@/lib/data/stock";
import { isDue, type Check } from "@/lib/stock/expiry";
import { EmptyNote } from "@/components/ui/empty-state";
import { ChangeFeed } from "@/components/stock/change-feed";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls } from "@/lib/data/use-list-query";
import { EntryDialog } from "../entry-dialog";
import { LEVELS, bottlesAt, levelSummary } from "@/lib/stock/levels";
import { alcoholPerKrona } from "@/lib/stock/onhand";
import { cn } from "@/lib/ui/utils";
import {
  formatClPerKrona,
  formatLitres,
  formatOreKr,
  formatMovementLitres,
  formatNumber,
  formatSigned,
} from "@/lib/ui/format";
import { systembolagetSearchUrl } from "@/lib/stock/systembolaget";

export default function StockProductClient({
  product,
  events,
  cellar,
  movements,
  checks,
  expiryUnset,
  knownTags,
  canManage,
}: {
  product: StockLevelDto;
  events: ProductEventDto[];
  cellar: CellarRowDto[];
  /** How many log rows point at this product: what delete would take with it. */
  movements: number;
  /** Every check this product will raise, oldest first. Not claims that anything went off: the app only knows when a delivery came in and how long the product keeps (lib/stock/expiry.ts). */
  checks: Check[];
  /** What the rest of the shelf is tagged with, for the edit dialog's picker. */
  knownTags: string[];
  canManage: boolean;
  /** No notice period has been chosen, so no checks are raised at all. */
  expiryUnset: boolean;
}) {
  const t = useTranslations("stock");
  const [editing, setEditing] = useState(false);
  const [buying, setBuying] = useState(false);
  // What a stocktake handed over when it turned out to be a delivery.
  const [buyingUnits, setBuyingUnits] = useState<number | undefined>(undefined);
  const [counting, setCounting] = useState(false);
  const [spoiling, setSpoiling] = useState(false);
  /** Which delivery is being ticked off, so only its own button spins. */
  const [checking, setChecking] = useState<string | null>(null);
  const [fixing, setFixing] = useState<CellarRowDto | null>(null);
  const confirm = useConfirm();
  const notify = useNotify();
  const returnTo = useReturnTo();
  const { mutate } = useMutation();

  // A stocktake that turned out to be a delivery becomes one (api/stock/entries/[id]/to-purchase).
  async function toPurchase(row: CellarRowDto) {
    const count = row.units ?? 0;
    const ok = await confirm({
      title: t("toPurchase.title"),
      message: t("toPurchase.message", { count, date: row.occurredAt ?? "" }),
      confirmLabel: t("toPurchase.confirm"),
    });
    if (!ok) return;
    await mutate(`/api/stock/entries/${row.id}/to-purchase`, {
      key: `to-purchase-${row.id}`,
      body: {},
      error: t("toPurchase.failed"),
      success: t("toPurchase.done", { count }),
    });
  }

  /**
   * Record that somebody looked at one delivery and found it fine. One at a time, since each crate is a task.
   * Silences it only until the notice period has run again. What had gone off leaves the shelf as a write-off instead.
   */
  async function markChecked(entryId: string) {
    setChecking(entryId);
    const done = await mutate<{ id: string }>(`/api/stock/entries/${entryId}/checked`, {
      method: "POST",
      error: t("expiry.checkFailed"),
    });
    setChecking(null);
    if (done === null) return;
    notify.success(t("expiry.checkedDone"));
  }

  /** Undo a product and its log. The warning depends on the count: removing a fresh typo differs from rewriting two terms of history. */
  async function remove() {
    const ok = await confirm({
      title: t("products.removeTitle", { name: product.name }),
      message:
        movements > 0
          ? t("products.removeUsed", { count: movements })
          : t("products.removeDescription"),
      confirmLabel: t("products.remove"),
      tone: "danger",
    });
    if (!ok) return;
    const gone = await mutate<{ entries: number }>(`/api/stock/products/${product.id}`, {
      method: "DELETE",
      error: t("products.removeFailed"),
    });
    if (gone === null) return;
    // Counted by the transaction, not the page: a night booked in between is a row this screen never knew.
    notify.success(
      gone.entries > 0
        ? t("products.removedWithLog", { count: gone.entries })
        : t("products.removed"),
    );
    // Not a push. The product is gone, and Back must not lead to its page.
    returnTo("/stock");
  }

  const isVolume = product.kind === "VOLUME";
  const { onHand } = product;
  /** What one whole thing holds: a bottle's nominal size, or a can's. */
  const size = isVolume ? product.nominalMl : product.unitMl;

  return (
    <PageShell
      // Identity only: type and counting are labelled rows in the card below.
      title={
        <span className="flex items-center gap-2.5">
          <CategoryMark category={product.category} size="lg" />
          {product.name}
        </span>
      }
      back="/stock"
      width="content"
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
      {/* Two columns from lg. `grid-cols-[minmax(0,1fr)]`, not a bare `grid`: an implicit `auto` column is as wide as its widest content, which made cards wider than a phone. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-6">
          <Card>
            <CardHeader
              title={t("product.inStock")}
              action={
                canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setBuying(true)}>
                      {t("products.purchase")}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setCounting(true)}>
                      {t("products.stocktake")}
                    </Button>
                    {/* Beside the stocktake: a broken bottle recorded as a count difference cannot be explained later. */}
                    <Button size="sm" variant="ghost" onClick={() => setSpoiling(true)}>
                      {t("products.spoilage")}
                    </Button>
                  </div>
                ) : undefined
              }
            />
            {/* Across rather than down, auto-fitting so a can's two cells and a spirit's six lay out alike. */}
            {/* The shelf as a picture first, as the list shows it. */}
            <div className="border-b border-border px-inset py-4">
              <BottleLevels
                kind={product.kind}
                sealed={onHand.units}
                open={onHand.open}
                size="lg"
              />
            </div>
            <CardBody className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-x-6 gap-y-4">
              <Detail
                label={isVolume ? t("product.sealed") : t("product.units")}
                value={String(onHand.units)}
              />
              {isVolume &&
                LEVELS.map((level) => (
                  <Detail
                    key={level}
                    label={t("field.levelOf", { level })}
                    value={String(bottlesAt(onHand.open, level))}
                    dim={bottlesAt(onHand.open, level) === 0}
                  />
                ))}
              {/* Sealed and open together: an estimate for a spirit (see openMl), and the figure the restaurangrapport asks for. */}
              <Detail
                label={t("product.totalVolume")}
                value={
                  onHand.totalMl == null
                    ? "-"
                    : t("litres", { litres: formatLitres(onHand.totalMl) })
                }
                dim={onHand.totalMl == null}
              />
              <Detail
                label={t("product.value")}
                value={onHand.valueOre > 0 ? formatOreKr(onHand.valueOre) : "-"}
              />
            </CardBody>
          </Card>

          {product.impossible && <p className="text-sm text-danger">{t("product.impossible")}</p>}
          {/* A made-up barcode from before the field checked: it cannot be scanned and the next edit refuses it. */}
          {product.ean && !validGtin(product.ean) && (
            <Notice>
              <p>{t("barcode.invalidHint")}</p>
            </Notice>
          )}

          {/* Best-before is hedged on purpose: the app has never seen a crate, only that a delivery came in and the product keeps so many months.
              A row per delivery, since the work is going down them ticking each off. Deliveries the shelf has been empty since are gone, not dismissed. */}
          {checks.length > 0 && (
            <Card>
              <CardHeader title={t("expiry.title")} subtitle={t("expiry.hint")} />
              <CheckTable
                checks={checks}
                canManage={canManage}
                pending={checking}
                onCheck={markChecked}
                onWriteOff={() => setSpoiling(true)}
              />
            </Card>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-6">
          {/* What the product is, apart from what there is of it: every field, so the page is the whole answer. */}
          <Card>
            <CardHeader
              title={t("product.details")}
              action={
                canManage ? (
                  <Menu
                    label={t("products.actions", { name: product.name })}
                    iconOnly
                    variant="ghost"
                    size="sm"
                    icon={<IconDots className="size-4" />}
                  >
                    <MenuItem onClick={() => setEditing(true)}>
                      <IconPencil className="size-4 shrink-0 text-muted" />
                      {t("products.edit")}
                    </MenuItem>
                    <MenuItem onClick={remove} className="text-danger hover:bg-danger-soft">
                      <IconTrash className="size-4 shrink-0" />
                      {t("products.remove")}
                    </MenuItem>
                  </Menu>
                ) : undefined
              }
            />
            <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 sm:grid-cols-2">
              <Detail
                label={t("products.field.category")}
                value={t(`category.${product.category}`)}
              />
              <Detail label={t("products.field.kind")} value={t(`kindName.${product.kind}`)} />
              <Detail
                label={t("products.field.tags")}
                value={
                  product.tags.length === 0 ? (
                    <span className="text-muted">-</span>
                  ) : (
                    <TagChips tags={product.tags} className="mt-0.5" />
                  )
                }
              />
              <Detail
                label={t("product.ean")}
                value={
                  product.ean ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="tabular-nums">{product.ean}</span>
                      {isInternalCode(product.ean) && <Tag size="sm">{t("barcode.ownTag")}</Tag>}
                      {!validGtin(product.ean) && (
                        <Tag size="sm" tone="warning">
                          {t("barcode.invalidTag")}
                        </Tag>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted">{t("product.noEan")}</span>
                  )
                }
              />
              <Detail
                label={t("products.field.systembolagetId")}
                value={
                  product.systembolagetId ? (
                    // Linked through their search, not a stored address: the canonical URL has a slug that changes on rename.
                    <a
                      href={systembolagetSearchUrl(product.systembolagetId) ?? "#"}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="tabular-nums text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
                    >
                      {product.systembolagetId}
                    </a>
                  ) : (
                    // Named rather than a dash: an empty one is a product with no article number, not an unfinished one.
                    <span className="text-muted">{t("product.noSystembolagetId")}</span>
                  )
                }
              />
              <Detail
                label={t("product.size")}
                value={size == null ? <span className="text-muted">-</span> : t("ml", { ml: size })}
              />
              <Detail
                label={t("product.abv")}
                value={
                  product.abv == null ? (
                    <span className="text-muted">-</span>
                  ) : (
                    `${formatNumber(product.abv, 0, 2)} %`
                  )
                }
              />
              <Detail
                label={t("product.unitCost")}
                value={
                  product.costPriceOre == null ? (
                    <span className="text-muted">{t("product.noCostPrice")}</span>
                  ) : (
                    formatOreKr(product.costPriceOre, { decimals: 2 })
                  )
                }
              />
              <Detail
                label={t("product.alcoholPerKrona")}
                value={
                  alcoholPerKrona(product) == null ? (
                    <span className="text-muted">-</span>
                  ) : (
                    t("clPerKrona", {
                      cl: formatClPerKrona(alcoholPerKrona(product)!),
                    })
                  )
                }
              />
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader title={t("product.events")} subtitle={t("product.eventsHint")} />
            <EventTable rows={events} kind={product.kind} />
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title={t("product.cellar")}
              subtitle={t("product.cellarHint")}
              action={
                <Link
                  href={`/stock/history?product=${product.id}`}
                  className="text-sm font-medium text-link"
                >
                  {t("product.wholeLog")}
                </Link>
              }
            />
            <CellarTable
              rows={cellar}
              canManage={canManage}
              onFix={setFixing}
              onToPurchase={toPurchase}
            />
          </Card>
        </div>
      </div>

      {editing && (
        <ProductDialog product={product} knownTags={knownTags} onClose={() => setEditing(false)} />
      )}
      {buying && (
        <PurchaseDialog
          product={product}
          initialUnits={buyingUnits}
          onClose={() => {
            setBuying(false);
            setBuyingUnits(undefined);
          }}
        />
      )}
      {counting && (
        <StocktakeDialog
          product={product}
          onClose={() => setCounting(false)}
          onPurchaseInstead={(units) => {
            setCounting(false);
            setBuyingUnits(units);
            setBuying(true);
          }}
        />
      )}
      {spoiling && <SpoilageDialog product={product} onClose={() => setSpoiling(false)} />}
      {fixing && <EntryDialog row={fixing} onClose={() => setFixing(null)} />}
    </PageShell>
  );
}

/** A fact about the product: the word for it, and the thing itself. Same shape as the utlägg's detail card. */
function Detail({
  label,
  value,
  dim,
}: {
  label: string;
  value: React.ReactNode;
  /** Nothing on this rung: kept visible but quiet. */
  dim?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted">{label}</p>
      <div
        className={cn("mt-0.5 text-sm font-medium tabular-nums", dim && "font-normal text-muted")}
      >
        {value}
      </div>
    </div>
  );
}

/** What the product did at each event it went out to, a row per night. The chevron appears only on a night somebody has since changed. */
function EventTable({ rows, kind }: { rows: ProductEventDto[]; kind: string }) {
  const t = useTranslations("stock");
  const controls = useTableControls();
  const amount = (n: number) => (kind === "VOLUME" ? formatMovementLitres(n) : String(n));

  const figure = (key: string, pick: (r: ProductEventDto) => number, strong = false) => ({
    key,
    header: t(`event.col.${key}`),
    align: "right" as const,
    className: "tabular-nums",
    value: pick,
    sortable: true,
    // Off a phone's row: out, back and spilled are the night's own sheet.
    mobile: "hide" as const,
    cell: (r: ProductEventDto) =>
      pick(r) === 0 ? (
        <span className="text-muted">-</span>
      ) : (
        <span className={strong ? "font-medium" : undefined}>{amount(pick(r))}</span>
      ),
  });

  const columns: Column<ProductEventDto>[] = [
    {
      key: "event",
      header: t("event.col.name"),
      value: (r) => r.tagName,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (r) => (
        <Link href={`/stock/events/${r.eventId}`} className="font-medium hover:underline">
          {r.tagName}
        </Link>
      ),
    },
    {
      key: "date",
      header: t("event.col.date"),
      className: "tabular-nums whitespace-nowrap",
      value: (r) => r.date,
      sortable: true,
      mobile: "meta",
      cell: (r) => r.date || <span className="text-muted">-</span>,
    },
    figure("out", (r) => r.out),
    figure("back", (r) => r.back),
    figure("spilled", (r) => r.spilled),
    { ...figure("sold", (r) => r.sold, true), mobile: "trailing" as const },
  ];

  return (
    <ClientDataTable
      columns={columns}
      rows={rows}
      controls={controls}
      rowKey={(r) => r.eventId}
      searchPlaceholder={t("product.searchEvents")}
      expansion={(r) =>
        r.changes.length ? <ChangeFeed changes={r.changes} scope="event" /> : null
      }
      empty={t("product.noEvents")}
    />
  );
}

/** Deliveries, stocktakes and the corrections made to them, in the order they were written down. */
function CellarTable({
  rows,
  canManage,
  onFix,
  onToPurchase,
}: {
  rows: CellarRowDto[];
  canManage: boolean;
  onFix: (row: CellarRowDto) => void;
  onToPurchase: (row: CellarRowDto) => void;
}) {
  const t = useTranslations("stock");
  const controls = useTableControls();
  const isChange = (r: CellarRowDto) => r.from !== undefined;

  const columns: Column<CellarRowDto>[] = [
    {
      key: "date",
      header: t("log.col.date"),
      className: "tabular-nums whitespace-nowrap",
      value: (r) => r.occurredAt ?? r.at.slice(0, 10),
      sortable: true,
      mobile: "meta",
      cell: (r) => r.occurredAt ?? r.at.slice(0, 10),
    },
    {
      key: "what",
      header: t("log.col.kind"),
      value: (r) => (isChange(r) ? t("product.correction") : t(`kind.${r.kind}`)),
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (r) => (
        <span className="font-medium">
          {isChange(r)
            ? t("product.correctionOf", { kind: t(`kind.${r.kind}`) })
            : t(`kind.${r.kind}`)}
        </span>
      ),
    },
    {
      key: "figure",
      header: t("log.col.units"),
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      mobile: "meta",
      // A movement says what it did to the shelf, a correction what the figure was and became.
      cell: (r) =>
        isChange(r) ? (
          <>
            <span className="text-muted">{r.from} → </span>
            <span className={cn("font-medium", r.to === 0 && "text-muted")}>{r.to}</span>
          </>
        ) : r.counted?.length ? (
          t("product.countedTo", { qty: r.counted.map((c) => c.qty).join(" / ") })
        ) : r.units ? (
          formatSigned(r.units)
        ) : (
          levelSummary(r.open ?? {}) || <span className="text-muted">-</span>
        ),
    },
    {
      key: "value",
      header: t("log.col.value"),
      align: "right",
      className: "tabular-nums",
      value: (r) => r.valueDeltaOre ?? 0,
      sortable: true,
      mobile: "trailing",
      cell: (r) =>
        r.valueDeltaOre ? formatOreKr(r.valueDeltaOre) : <span className="text-muted">-</span>,
    },
    {
      key: "actor",
      header: t("log.col.actor"),
      className: "text-muted",
      value: (r) => r.actorName,
      sortable: true,
      searchable: true,
      // Off the phone row: the note hangs off a second line a one-line summary lacks. Both are on the change feed.
      mobile: "hide",
      cell: (r) => (
        <>
          {r.actorName}
          {r.note && <span className="block text-xs">{r.note}</span>}
        </>
      ),
    },
    {
      key: "fix",
      header: "",
      align: "right",
      // A button, so it goes with the buttons rather than the row's second line.
      mobile: "actions",
      hidden: !canManage,
      cell: (r) =>
        r.fixable ? (
          <Button
            variant="link"
            type="button"
            onClick={() => onFix(r)}
            className="relative z-10 text-xs"
          >
            {t("entry.fix")}
          </Button>
        ) : r.kind === "COUNT" && (r.units ?? 0) > 0 ? (
          // A count that found more sealed than expected is often a delivery booked as a stocktake. Offered, not assumed.
          <Button
            variant="link"
            type="button"
            onClick={() => onToPurchase(r)}
            className="relative z-10 whitespace-nowrap text-xs"
          >
            {t("toPurchase.action")}
          </Button>
        ) : null,
    },
  ];

  return (
    <ClientDataTable
      columns={columns}
      rows={rows}
      controls={controls}
      rowKey={(r) => r.id}
      searchPlaceholder={t("product.searchCellar")}
      empty={t("product.noCellar")}
    />
  );
}

/**
 * The best-before schedule for one product: a row per delivery still on the books, oldest first.
 * A plain list, not a DataTable. Every date is an estimate and every line says so (the app has never seen a crate).
 */
function CheckTable({
  checks,
  canManage,
  pending,
  onCheck,
  onWriteOff,
}: {
  checks: Check[];
  canManage: boolean;
  /** The delivery currently being ticked off, so one button spins and not all. */
  pending: string | null;
  onCheck: (entryId: string) => void;
  onWriteOff: () => void;
}) {
  const t = useTranslations("stock");

  if (checks.length === 0) {
    return (
      <div className="px-inset py-6">
        <EmptyNote>{t("expiry.none")}</EmptyNote>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {checks.map((check) => {
        const due = isDue(check);
        return (
          <li
            key={check.entryId}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-inset py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "text-sm tabular-nums",
                    due ? "font-medium text-foreground" : "text-muted",
                  )}
                >
                  {check.bestBefore}
                </span>
                {/* Only a row that is actually owed gets a colour. */}
                {check.quiet ? (
                  <Tag size="sm">{t("expiry.stateChecked", { date: check.checkedAt ?? "" })}</Tag>
                ) : check.state === "over" ? (
                  <Tag size="sm" tone="warning">
                    {t("expiry.stateOver", { days: -check.daysLeft })}
                  </Tag>
                ) : check.state === "soon" ? (
                  <Tag size="sm" className="text-foreground">
                    {t("expiry.stateSoon", { days: check.daysLeft })}
                  </Tag>
                ) : (
                  <span className="text-xs text-muted">
                    {t("expiry.stateLater", { days: check.daysLeft })}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {t("expiry.deliveredOn", { date: check.occurredAt })}
              </p>
            </div>

            {/* Only on a row that is asking. */}
            {canManage && due && (
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onCheck(check.entryId)}
                  loading={pending === check.entryId}
                >
                  {t("expiry.checked")}
                </Button>
                <Button size="sm" variant="ghost" onClick={onWriteOff}>
                  {t("products.spoilage")}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
