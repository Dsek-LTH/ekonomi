"use client";

// One product: what there is of it, and what has happened to it.
//
// The page a name in the list opens, and where everything you do *to* a product
// lives: a delivery, a stocktake, a correction to its details. The nightly in
// and out is not here: that is done from the log, against whichever products a
// night happens to touch, and coming to a product page per bottle would be the
// slower way round.
//
// Two halves, in the order somebody wants them. What is on the shelf, spelled
// out bottle by bottle rather than as a total. "3 sealed, 1 at 60 %" is the
// sentence you came for. Then the last movements, because the next question
// after a surprising number is always how it got there.
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
import { PurchaseDialog, SpoilageDialog, StocktakeDialog } from "../product-actions";
import { ProductDialog } from "../product-dialog";
import { TagChips } from "@/components/stock/tag-chips";
import type { CellarRowDto, ProductEventDto, StockLevelDto } from "@/lib/data/stock";
import { isDue, type Check } from "@/lib/stock/expiry";
import { EmptyNote } from "@/components/ui/empty-state";
import { ChangeFeed } from "@/components/stock/change-feed";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import { EntryDialog } from "../entry-dialog";
import { LEVELS, bottlesAt } from "@/lib/stock/levels";
import { alcoholPerKrona } from "@/lib/stock/onhand";
import { cn } from "@/lib/ui/utils";
import { systembolagetSearchUrl } from "@/lib/stock/systembolaget";

const kr = (ore: number) =>
  `${new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ore / 100)} kr`;

const litres = (ml: number) =>
  new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    ml / 1000,
  );

const clPerKrona = (cl: number) =>
  new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    cl,
  );

const signed = (n: number) =>
  new Intl.NumberFormat("sv-SE", { signDisplay: "exceptZero" }).format(n);

/** A row's effect on the open bottles, as "80 % → 40 %" or "+ 60 %". */
function levelSummary(open: Record<number, number>): string {
  const left = LEVELS.filter((l) => (open[l] ?? 0) < 0);
  const arrived = LEVELS.filter((l) => (open[l] ?? 0) > 0);
  const part = (levels: number[]) =>
    levels.map((l) => `${Math.abs(open[l] ?? 0) > 1 ? `${Math.abs(open[l] ?? 0)}×` : ""}${l} %`).join(", ");
  if (left.length && arrived.length) return `${part(left)} → ${part(arrived)}`;
  if (left.length) return `− ${part(left)}`;
  if (arrived.length) return `+ ${part(arrived)}`;
  return "";
}

export default function StockProductClient({
  product,
  events,
  cellar,
  movements,
  checks,
  knownTags,
  canManage,
}: {
  product: StockLevelDto;
  events: ProductEventDto[];
  cellar: CellarRowDto[];
  /** How many rows of the log point at this product. What delete would take
   *  with it, which is the one thing the confirmation has to say. */
  movements: number;
  /**
   * Every check this product will raise, oldest date first.
   *
   * Not claims that anything has gone off. Nothing is written on the crates in
   * this cellar, so the app knows only that a delivery came in on a day and
   * that the product keeps so many months. See lib/stock/expiry.ts.
   */
  checks: Check[];
  /** What the rest of the shelf is tagged with, for the edit dialog's picker. */
  knownTags: string[];
  canManage: boolean;
}) {
  const t = useTranslations("stock");
  const [editing, setEditing] = useState(false);
  const [buying, setBuying] = useState(false);
  const [counting, setCounting] = useState(false);
  const [spoiling, setSpoiling] = useState(false);
  /** Which delivery is being ticked off, so only its own button spins. */
  const [checking, setChecking] = useState<string | null>(null);
  const [fixing, setFixing] = useState<CellarRowDto | null>(null);
  const confirm = useConfirm();
  const notify = useNotify();
  const returnTo = useReturnTo();
  const { mutate } = useMutation();

  /**
   * Record that somebody went and looked at one delivery, and found it fine.
   *
   * One at a time, because each of these is a task rather than a fact about the
   * shelf: a person reads one crate, ticks it off, and moves to the next. That
   * the cellar cannot tell two crates of the same lager apart is the reason
   * they are separate tasks and not one, since nobody can be sure the second
   * says what the first did.
   *
   * It does not silence the delivery for good, only until the notice period has
   * run again, which is right. It is still a crate and it is a month closer to
   * the date.
   *
   * Whatever they found that *had* gone off leaves the shelf as a write-off,
   * through the button beside this one. That is a movement of stock; this is a
   * note that somebody looked.
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

  /**
   * Undo a product, and the log with it.
   *
   * Two different acts wearing one word. Over a product typed wrong a minute
   * ago this removes a row nothing points at; over one that has been booked on
   * for two terms it rewrites what the shelf has been worth and what was
   * bought. So the question changes with the count rather than the button: the
   * warning is only true when there is something to warn about, and a dialog
   * that cries wolf over an empty product is one people stop reading.
   */
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
    // What it actually took, counted by the transaction rather than by the page:
    // a night booked between the two is a row this screen never knew about.
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
      // Identity only: what sort of drink it is and how it is counted are facts
      // about the product like any other, and they read better as labelled rows
      // in the card below than as a clause under the name.
      title={product.name}
      back={{ href: "/stock", label: t("title") }}
      width="content"
    >
      {/* `grid-cols-[minmax(0,1fr)]`, not a bare `grid`. An implicit column is
          `auto`, whose minimum is the min-content of what sits in it, so the
          widest thing in any of these cards decides the column's width and the
          cards then stand wider than the screen. On a phone that was 346px of
          card in 280px of page, and the whole document scrolled sideways. The
          `minmax(0, …)` is what lets the column be as narrow as it is given. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        {/* What the product *is*, kept apart from what there is of it. The card
            below answers "how much have we got"; this one answers the questions
            that come up when somebody is holding the tin and not sure it is the
            right one: is this the 33 cl or the 50, is this the one we pay
            twelve kronor for. Every field the product carries is here, so the
            page is the whole answer and not a summary of one. */}
        <Card>
          {/* What you can do to a thing belongs to the thing: changing what the
              product *is* rides the card that says what it is, and the two that
              move stock ride the card that counts it. */}
          <CardHeader
            title={t("product.details")}
            action={
              canManage ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                    {t("products.edit")}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft" onClick={remove}>
                    {t("products.remove")}
                  </Button>
                </div>
              ) : undefined
            }
          />
          <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 sm:grid-cols-2">
            <Detail
              label={t("products.field.category")}
              value={t(`category.${product.category}`)}
            />
            <Detail
              label={t("products.field.kind")}
              value={t(`kindName.${product.kind}`)}
            />
            <Detail
              label={t("products.field.tags")}
              value={
                product.tags.length === 0 ? (
                  <span className="text-muted">–</span>
                ) : (
                  <TagChips tags={product.tags} className="mt-0.5" />
                )
              }
            />
            <Detail
              label={t("product.ean")}
              value={
                product.ean ? (
                  <span className="tabular-nums">{product.ean}</span>
                ) : (
                  <span className="text-muted">{t("product.noEan")}</span>
                )
              }
            />
            <Detail
              label={t("products.field.systembolagetId")}
              value={
                product.systembolagetId ? (
                  // Linked because the number is only useful as a way back to
                  // the page it came from: a price, a new vintage, the article
                  // being delisted. Through their search rather than a stored
                  // address: the canonical URL carries a slug that changes when
                  // a product is renamed, and the number does not.
                  <a
                    href={systembolagetSearchUrl(product.systembolagetId) ?? "#"}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="tabular-nums text-accent hover:underline"
                  >
                    {product.systembolagetId}
                  </a>
                ) : (
                  // Named, like the missing barcode above it, rather than left
                  // as a dash. The field is for finding the article's page
                  // again, and plenty of the cellar is not bought there at all,
                  // so an empty one is a product with no article number and not
                  // a product somebody forgot to finish.
                  <span className="text-muted">{t("product.noSystembolagetId")}</span>
                )
              }
            />
            <Detail
              label={t("product.size")}
              value={
                size == null ? (
                  <span className="text-muted">–</span>
                ) : (
                  t("ml", { ml: size })
                )
              }
            />
            <Detail
              label={t("product.abv")}
              value={
                product.abv == null ? (
                  <span className="text-muted">–</span>
                ) : (
                  `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(product.abv)} %`
                )
              }
            />
            <Detail
              label={t("product.unitCost")}
              value={
                product.costPriceOre == null ? (
                  <span className="text-muted">{t("product.noCostPrice")}</span>
                ) : (
                  kr(product.costPriceOre)
                )
              }
            />
            <Detail
              label={t("product.alcoholPerKrona")}
              value={
                alcoholPerKrona(product) == null ? (
                  <span className="text-muted">–</span>
                ) : (
                  t("clPerKrona", { cl: clPerKrona(alcoholPerKrona(product)!) })
                )
              }
            />
          </CardBody>
        </Card>

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
                  {/* Beside the stocktake rather than hidden behind it, because
                      a broken bottle recorded as a count difference is a
                      difference nobody can explain a term later. */}
                  <Button size="sm" variant="ghost" onClick={() => setSpoiling(true)}>
                    {t("products.spoilage")}
                  </Button>
                </div>
              ) : undefined
            }
          />
          {/* Across rather than down. What is in stock is a handful of small
              numbers that are read together, five rungs and a value, and a
              stacked list made each one a line to scroll past instead of a
              figure to take in at a glance. Auto-fitting columns, so a can's
              two cells and a spirit's six lay themselves out without the page
              knowing which it is looking at. */}
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
            {/* Sealed and open together, which is an estimate stacked on
                estimates for a spirit (see openMl) and exactly the figure the
                restaurangrapport asks for. */}
            <Detail
              label={t("product.totalVolume")}
              value={
                onHand.totalMl == null ? "–" : t("litres", { litres: litres(onHand.totalMl) })
              }
              dim={onHand.totalMl == null}
            />
            <Detail
              label={t("product.value")}
              value={onHand.valueOre > 0 ? kr(onHand.valueOre) : "–"}
            />
          </CardBody>
        </Card>

        {product.impossible && (
          <p className="text-sm text-danger">{t("product.impossible")}</p>
        )}

        {/* The whole best-before feature, and hedged on purpose in every line
            of it. The app has never seen a crate. It knows a delivery came in
            on a day and that the product keeps so many months, so what it can
            honestly ask for is somebody to go and read the label.

            A row per delivery rather than one notice, because that is how the
            work is done: go down, find the crate that came in on this date,
            read it, tick it off, and start on the next one. The overview folds
            these to a single flag; this is where they get worked through.

            Deliveries the shelf has been empty since are not here at all. They
            are not dismissed, they are gone. */}
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

        {/* What it did at nights, per night. The same shape as the event sheet,
            because it is the same question asked of one product: what went out,
            what came back, and what that came to. Anything somebody later
            changed about a night hangs off that night's own row. */}
        <Card>
          <CardHeader
            title={t("product.events")}
            subtitle={t("product.eventsHint")}
          />
          <EventTable rows={events} kind={product.kind} />
        </Card>

        {/* And what has been done to it in the cellar, which is a different
            sort of event, and a list rather than a per-night fold. Corrections
            live here rather than in a card of their own: putting a delivery
            right is the same kind of deliberate act as making one. */}
        <Card>
          <CardHeader
            title={t("product.cellar")}
            subtitle={t("product.cellarHint")}
            action={
              <Link
                href={`/stock/log?product=${product.id}`}
                className="text-sm font-medium text-accent"
              >
                {t("product.wholeLog")}
              </Link>
            }
          />
          <CellarTable rows={cellar} canManage={canManage} onFix={setFixing} />
        </Card>
      </div>

      {editing && (
        <ProductDialog
          product={product}
          knownTags={knownTags}
          onClose={() => setEditing(false)}
        />
      )}
      {buying && <PurchaseDialog product={product} onClose={() => setBuying(false)} />}
      {counting && <StocktakeDialog product={product} onClose={() => setCounting(false)} />}
      {spoiling && <SpoilageDialog product={product} onClose={() => setSpoiling(false)} />}
      {fixing && <EntryDialog row={fixing} onClose={() => setFixing(null)} />}
    </PageShell>
  );
}

/** One line of the shelf: what it is, and how many. */
/**
 * A fact about the product: the word for it, and the thing itself.
 *
 * The same shape as the utlägg's detail card, which is the other place in the
 * app that lists what a thing is, and the same shape for the stock figures as
 * for the reference data, because they are read the same way. They were two
 * components for a while, with the figures set large and uppercase; six of them
 * in a row read as a dashboard shouting at somebody who had come to check a
 * bottle size.
 */
function Detail({
  label,
  value,
  dim,
}: {
  label: string;
  value: React.ReactNode;
  /** Nothing on this rung. Kept visible, since an empty rung is information, but
   *  quiet, so the eye goes to the ones holding something. */
  dim?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted">{label}</p>
      <div
        className={cn(
          "mt-0.5 text-sm font-medium tabular-nums",
          dim && "font-normal text-muted",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * What the product did at each event it went out to.
 *
 * A row per night rather than per movement, in the shape of the event sheet: out,
 * back, spilled, and what that came to. The chevron appears only on a night
 * somebody has since changed, and says who changed what. A correction to a
 * night's figure belongs to that night, not to a list of every correction ever
 * made to the product.
 */
function EventTable({ rows, kind }: { rows: ProductEventDto[]; kind: string }) {
  const t = useTranslations("stock");
  const controls = useTableControls();
  const amount = (n: number) =>
    kind === "VOLUME"
      ? `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(n / 1000)} l`
      : String(n);

  const figure = (key: string, pick: (r: ProductEventDto) => number, strong = false) => ({
    key,
    header: t(`event.col.${key}`),
    align: "right" as const,
    className: "tabular-nums",
    value: pick,
    sortable: true,
    mobile: "meta" as const,
    cell: (r: ProductEventDto) =>
      pick(r) === 0 ? (
        <span className="text-muted">–</span>
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
      cell: (r) => r.date || <span className="text-muted">–</span>,
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
      expansion={(r) => (r.changes.length ? <ChangeFeed changes={r.changes} scope="event" /> : null)}
      empty={t("product.noEvents")}
    />
  );
}

/**
 * Deliveries, stocktakes and the corrections made to them.
 *
 * The cellar's own history, in the order things were written down rather than
 * the order they are about, which is the order somebody reconstructing a
 * figure is following. A correction sits here beside the delivery it puts
 * right, because making a delivery and fixing one are the same sort of act.
 */
function CellarTable({
  rows,
  canManage,
  onFix,
}: {
  rows: CellarRowDto[];
  canManage: boolean;
  onFix: (row: CellarRowDto) => void;
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
          {isChange(r) ? t("product.correctionOf", { kind: t(`kind.${r.kind}`) }) : t(`kind.${r.kind}`)}
        </span>
      ),
    },
    {
      key: "figure",
      header: t("log.col.units"),
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      mobile: "meta",
      // A movement says what it did to the shelf; a correction says what the
      // figure was and what it became. Both are "the number on this row".
      cell: (r) =>
        isChange(r) ? (
          <>
            <span className="text-muted">{r.from} → </span>
            <span className={cn("font-medium", r.to === 0 && "text-muted")}>{r.to}</span>
          </>
        ) : r.counted?.length ? (
          t("product.countedTo", { qty: r.counted.map((c) => c.qty).join(" / ") })
        ) : r.units ? (
          signed(r.units)
        ) : (
          levelSummary(r.open ?? {}) || <span className="text-muted">–</span>
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
        r.valueDeltaOre ? kr(r.valueDeltaOre) : <span className="text-muted">–</span>,
    },
    {
      key: "actor",
      header: t("log.col.actor"),
      className: "text-muted",
      value: (r) => r.actorName,
      sortable: true,
      searchable: true,
      // Off the phone row: the cell hangs the note off a second line, which a
      // one-line summary has nowhere to put. Both are on the change feed.
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
      // A button, so it goes where the buttons go rather than into a line of
      // dot-separated facts.
      mobile: "actions",
      hidden: !canManage,
      cell: (r) =>
        r.fixable ? (
          <button
            type="button"
            onClick={() => onFix(r)}
            className="relative z-10 text-xs font-medium text-accent hover:underline"
          >
            {t("entry.fix")}
          </button>
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
 * The best-before schedule for one product: a row per delivery still on the
 * books, oldest date first.
 *
 * A plain list rather than a DataTable. There is nothing to search, nothing to
 * sort (the order is the whole point) and rarely more than a handful of rows,
 * and the errand is to work down them ticking each one off. A table's furniture
 * would be furniture around three facts.
 *
 * Every date on it is an estimate and every line says so. The app has never
 * seen a crate: it knows when a delivery arrived and how long the product
 * keeps, which is enough to send somebody to the cellar and not enough to
 * claim anything about what is down there.
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
                {/* What the date means, in the tense it deserves. Only a row
                    that is actually owed gets a colour; the rest are a
                    schedule, and a page of amber pills is a page nobody
                    reads. */}
                {check.quiet ? (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                    {t("expiry.stateChecked", { date: check.checkedAt ?? "" })}
                  </span>
                ) : check.state === "over" ? (
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                    {t("expiry.stateOver", { days: -check.daysLeft })}
                  </span>
                ) : check.state === "soon" ? (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {t("expiry.stateSoon", { days: check.daysLeft })}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted">
                    {t("expiry.stateLater", { days: check.daysLeft })}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {t("expiry.deliveredOn", { date: check.occurredAt })}
              </p>
            </div>

            {/* Only on a row that is asking. A dismiss button beside a date six
                months off would invite somebody to clear the list rather than
                to answer it. */}
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
