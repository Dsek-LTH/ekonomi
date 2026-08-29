"use client";

// A delivery, as a sheet.
//
// The errand is a pallet: a trolley of crates arriving from Systembolaget with
// an invoice beside it, twenty different products on it, and somebody standing
// in the cellar with a phone. The per-product form (stock/product-actions.tsx)
// answers "we bought some more Fireball" in four fields and a button, and it is
// the wrong shape entirely for twenty of them — twenty products found in a
// list, twenty dialogs opened, twenty dates typed.
//
// So it borrows the occasion sheet's shape (stock/tags/[id]/tag-client.tsx),
// with two columns instead of three: the product, and how many of it came in.
// Deliberately the same vocabulary — a row per product, a spare row at the foot
// that adds one, a scanner beside it, and cells that book themselves when you
// leave them. The two are the same act in opposite directions and should not
// feel like two different tools.
//
// Two columns is not a simplification of three; it is what a delivery is.
// Everything bought arrives sealed — the route refuses a delivery that moved a
// rung (see `entryFault`, "purchaseArrivesSealed") — so a spirit has no ladder
// here and a bottle of vodka is one row exactly like a can of beer.
//
// Nothing is confirmed, for the reason the occasion sheet gives: a sheet with a
// save button is a sheet that can be half filled in and abandoned, and this one
// is filled in standing at a pallet. A cell commits when you leave it, and what
// is on the screen is what is in the log.
//
// What makes that possible for deliveries specifically is that a delivery row
// can be changed after the fact — see api/stock/entries/[id]/route.ts, which
// exists for exactly the "200 bottles meaning 20" case. So a cell's three
// answers map onto three requests: a figure where there was none creates the
// row, a different figure changes it, and an emptied cell removes it. The log
// keeps the correction either way, as a StockChange.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DateInput, Field, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconScan, IconX } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useConfirm } from "@/components/confirm-dialog";
import { useLocalDraft } from "@/lib/ui/use-local-draft";
import { useProductScan } from "@/components/stock/use-product-scan";
import { isExpression, isQuantityInput, quantity } from "@/lib/stock/quantity";
import { useGridFocus } from "@/lib/ui/use-grid-focus";
import type { StockLevelDto } from "@/lib/data/stock";
import type { CreateStockEntry } from "@/lib/api/schemas/stock";
import { cn } from "@/lib/ui/utils";

/** Öre, to the öre — this is read against an invoice. */
const kr = (ore: number) =>
  `${new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    ore / 100,
  )} kr`;

/**
 * The sheet as it stands, unsent.
 *
 * One object rather than four pieces of state, because it is one thing —
 * what somebody has typed and not yet booked — and it is written to
 * localStorage as one thing (see lib/ui/use-local-draft.ts). A pallet is filled
 * in over ten minutes on a phone that locks itself; losing it to a sleeping
 * screen was the only way this sheet could waste somebody's afternoon.
 *
 * Products by id and quantities as text, not as numbers: the text is what was
 * typed — `24*10+30` — and resolving it on the way into storage would throw
 * away the working somebody may want to correct.
 */
type Draft = {
  /** The products on the sheet, in the order they were put there. */
  rows: string[];
  /** What is in each row's box, keyed by product id. */
  typed: Record<string, string>;
  occurredAt: string;
  note: string;
};

/** Its own key, so a draft cannot be read back onto a different screen. */
const DRAFT_KEY = "stock:delivery:draft";

export default function DeliveryClient({
  products,
  today,
}: {
  products: StockLevelDto[];
  /** Today in Stockholm, decided by the server — see the page. */
  today: string;
}) {
  const t = useTranslations("stock");
  const router = useRouter();
  const notify = useNotify();
  const confirm = useConfirm();
  const { mutate } = useMutation();
  const [saving, setSaving] = useState(false);

  const [draft, setDraft, clearDraft] = useLocalDraft<Draft>(DRAFT_KEY, {
    rows: [],
    typed: {},
    occurredAt: today,
    note: "",
  });
  const { rows, typed, occurredAt, note } = draft;
  const setRows = (next: (prev: string[]) => string[]) =>
    setDraft((d) => ({ ...d, rows: next(d.rows) }));
  const setTyped = (next: (prev: Record<string, string>) => Record<string, string>) =>
    setDraft((d) => ({ ...d, typed: next(d.typed) }));
  const setOccurredAt = (v: string) => setDraft((d) => ({ ...d, occurredAt: v }));
  const setNote = (v: string) => setDraft((d) => ({ ...d, note: v }));

  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** A product just added, waiting for the caret. */
  const [seeking, setSeeking] = useState<string | null>(null);

  /** Every cell's input, so the keyboard can move between them. */
  // The caret's own layer — shared with the stocktake sheet.
  const { focusCell, register, handleKey } = useGridFocus();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // ── What a cell says ──
  //
  // The same three functions the occasion sheet has, and the same distinction:
  // `number` is what would be written, `display` is what is on the screen. A
  // cell shows its working while the caret is in it — `24*10+30` — and the
  // answer the rest of the time, which is the whole reason a delivery cell
  // takes a sum at all. Ten crates of twenty-four plus the thirty loose ones on
  // the pallet is arithmetic done standing up, and asking for 270 is how 260
  // ends up in the log. See lib/stock/quantity.ts.
  const number = (id: string): number => {
    const text = typed[id];
    if (text === undefined || text.trim() === "") return 0;
    const q = quantity(text);
    return q.ok ? q.value : 0;
  };

  const display = (id: string): string => {
    const raw = typed[id];
    if (raw === undefined) return "";
    if (focusKey === id) return raw;
    if (raw.trim() === "") return "";
    const q = quantity(raw);
    // A sum that does not add up yet stays as typed rather than resolving to
    // something it does not say.
    return q.ok ? String(q.value) : raw;
  };

  const type = (id: string, text: string) => {
    if (!isQuantityInput(text)) return;
    setTyped((prev) => ({ ...prev, [id]: text }));
  };

  // ── What the pallet comes to ──
  //
  // Priced from the product rather than from anything typed here, because that
  // is what the route will value it at: a delivery is worth the purchase price
  // on the product times the count (lib/stock/value.ts). Which makes this the
  // one figure worth putting on the screen — it is what the invoice should say,
  // and a delivery whose total is out by a hundred kronor is a count or a price
  // that is wrong, found while somebody is still standing next to the pallet.
  const totalOre = rows.reduce(
    (sum, id) => sum + (byId.get(id)?.costPriceOre ?? 0) * number(id),
    0,
  );
  /** Products on the sheet that would go on the shelf worth nothing. */
  const unpriced = rows.filter((id) => byId.get(id)?.costPriceOre == null);

  // ── Booking ──

  /** The rows that would be written: a product and a positive count. */
  const pending_rows = rows
    .map((id) => ({ id, qty: number(id) }))
    .filter((r) => r.qty > 0 && byId.has(r.id));

  /**
   * Write the whole sheet.
   *
   * One row per product, each a PURCHASE of that many sealed units — the same
   * movement the per-product form writes, and the same route. There is no bulk
   * endpoint to send them through, so they go one at a time; a pallet is twenty
   * or thirty of them, which is a second's work and not worth a new route that
   * would have to repeat the whole of `entryFault`.
   *
   * Sequential rather than in parallel, and it matters: every delivery makes the
   * server replay that product's log to re-price what came after it
   * (`replayProduct`), and two of those racing on the same product would each
   * replay against a shelf the other was still changing.
   *
   * What fails stays. A row the server refuses is left in the draft with its
   * figure, and the ones that went through are taken out — so pressing Save
   * again sends exactly what is still owed rather than a second copy of what is
   * already in the log.
   */
  async function save() {
    if (pending_rows.length === 0 || saving) return;
    setSaving(true);
    const written: string[] = [];
    try {
      for (const row of pending_rows) {
        const body: CreateStockEntry = {
          productId: row.id,
          kind: "PURCHASE",
          occurredAt,
          units: row.qty,
          note: note.trim() || undefined,
        };
        const made = await mutate<{ id: string }>("/api/stock/entries", {
          key: "save",
          method: "POST",
          body,
          refresh: false,
          error: t("delivery.failed"),
        });
        // `mutate` has already said what went wrong. Stopping rather than
        // carrying on: whatever refused this row — a product that no longer
        // exists, a shelf the figures cannot reach — is more likely to refuse
        // the next one too, and a screen that reports twenty failures in a row
        // has told somebody nothing they can act on.
        if (!made) break;
        written.push(row.id);
      }
    } finally {
      setSaving(false);
    }

    if (written.length === 0) return;

    const done = new Set(written);
    setDraft((d) => ({
      ...d,
      rows: d.rows.filter((id) => !done.has(id)),
      typed: Object.fromEntries(Object.entries(d.typed).filter(([id]) => !done.has(id))),
    }));
    notify.success(t("delivery.saved", { count: written.length }));
    // Only now: the shelf figures and the product list this screen was drawn
    // from are a delivery out of date, and nothing on the sheet was waiting on
    // them until something was actually written.
    router.refresh();
  }

  /**
   * Throw the whole sheet away.
   *
   * Asked first, because there is nothing behind it: the draft is the only copy
   * of what somebody has been typing for the last ten minutes, and the button
   * is one line away from the one that saves it.
   */
  async function discard() {
    const ok = await confirm({
      title: t("delivery.discardTitle"),
      message: t("delivery.discardMessage", { count: pending_rows.length }),
      confirmLabel: t("delivery.discard"),
      tone: "danger",
    });
    if (ok) clearDraft();
  }

  /**
   * Take a product off the sheet.
   *
   * Nothing has been written yet, so this is only forgetting what was typed —
   * which is the whole difference a save button makes to this row: picking the
   * wrong beer used to mean a movement to undo, and now it means a line to
   * delete.
   */
  function drop(id: string) {
    setDraft((d) => {
      const typed = { ...d.typed };
      delete typed[id];
      return { ...d, rows: d.rows.filter((row) => row !== id), typed };
    });
  }

  function add(id: string) {
    if (!byId.has(id)) return;
    setRows((prev) => (prev.includes(id) ? prev : [...prev, id]));
    // Straight into the box, so picking a product and saying how many of it is
    // one movement rather than two.
    setSeeking(id);
  }

  // Scanning a barcode onto the sheet, and inventing a product that isn't
  // there yet — shared with the stocktake tag, which does the same errand.
  const { scan, invent, overlay } = useProductScan({
    unknownError: t("scan.unknown"),
    onScanned: (id) => add(id),
  });

  // ── Walking the sheet ──
  //
  // One column, so the grid is a column of one-cell rows and lib/ui/grid-nav.ts
  // does the rest. Worth the two lines even at this width: Enter down a column
  // of counts is how a sheet is filled in, and the browser's own tab order
  // would take the caret through each row's product link and remove button on
  // the way.
  const grid: (string | null)[][] = rows.map((id) => [id]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!seeking) return;
    if (!focusCell(seeking)) return;
    setSeeking(null);
    // Re-run when the row it wants may have appeared: after the add, and again
    // when the server sends a product that was just created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeking, products, rows]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // One column, so there is nowhere sideways to go and left/right stay with
  // the text.
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, id: string) =>
    handleKey(e, id, grid, { onEscape: (k) => setTyped((prev) => ({ ...prev, [k]: "" })) });

  // ── A cell ──
  //
  // A function that returns an input, not a component: a component declared in
  // here would be a new type on every render, and React unmounts a subtree whose
  // type changed — which takes the focus out of the box on the first keystroke.
  function cellFor(product: StockLevelDto) {
    const id = product.id;
    const raw = typed[id];
    const changed = raw !== undefined && number(id) > 0;
    const working = raw !== undefined && focusKey !== id && isExpression(raw);
    return (
      <input
        ref={register(id)}
        inputMode="numeric"
        className={cn(
          "block h-10 w-full bg-transparent px-2 text-center text-sm tabular-nums placeholder:text-muted/50 focus-inset",
          // A cell on its way to the log over a cell that merely holds working.
          changed ? "bg-warning-soft/60 font-medium" : working && "bg-accent-soft/40",
        )}
        value={display(id)}
        title={working ? raw : undefined}
        placeholder="0"
        // Arriving seeds the cell with what it already says, so correcting 200
        // to 20 is an edit rather than a retype.
        onFocus={(e) => {
          setFocusKey(id);
          setTyped((prev) => (prev[id] === undefined ? { ...prev, [id]: "" } : prev));
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => type(id, e.target.value)}
        onBlur={() => setFocusKey((k) => (k === id ? null : k))}
        onKeyDown={(e) => onCellKey(e, id)}
        aria-label={`${product.name} · ${t("delivery.col.in")}`}
      />
    );
  }

  const headerCell = "px-2 py-2.5 text-center font-medium";

  return (
    <PageShell
      title={t("delivery.title")}
      description={t("delivery.description")}
      back={{ href: "/stock", label: t("title") }}
      width="wide"
    >
      <Card>
        <CardHeader
          title={t("delivery.sheet")}
          subtitle={t("delivery.counts", { count: rows.length })}
          action={
            // The figure the sheet exists to be checked against, in the corner
            // the stock list keeps its own total in.
            <div className="flex flex-col text-right">
              <span className="text-xs uppercase tracking-wide text-muted">
                {t("delivery.total")}
              </span>
              <span className="mt-1 flex h-11 items-center justify-end text-lg font-semibold tabular-nums sm:h-9">
                {kr(totalOre)}
              </span>
            </div>
          }
        />

        {/* What the whole delivery has in common: when it arrived, and what to
            call it. Above the sheet rather than on every row, because an
            invoice is one date and one number however many products it lists. */}
        <div className="grid gap-3 border-b border-border px-inset py-3 sm:grid-cols-2">
          <Field label={t("field.date")}>
            <DateInput
              size="sm"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </Field>
          <Field label={t("field.note")} hint={t("delivery.noteHint")}>
            <Input
              size="sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("delivery.notePlaceholder")}
            />
          </Field>
        </div>

        {/* No CardBody: the sheet is ruled to the card's own edge, the way the
            occasion sheet and the voucher editor are. */}
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="divide-x divide-border border-b border-border bg-surface/40 text-xs text-muted">
              <th className={cn(headerCell, "w-[64%] text-left")}>
                {t("delivery.col.product")}
              </th>
              <th className={cn(headerCell, "w-[36%]")}>{t("delivery.col.in")}</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border/40">
            {rows.map((id) => {
              const product = byId.get(id);
              if (!product) return null;
              return (
                <tr key={id} className="divide-x divide-border">
                  <td className="group px-2 py-1.5 align-middle">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <Link href={`/stock/${id}`} className="font-medium hover:underline">
                          {product.name}
                        </Link>
                        {/* The unit price, because the total above is only
                            checkable if the parts of it are. A product with no
                            price says so here rather than quietly contributing
                            nothing to it. */}
                        <span
                          className={cn(
                            "ml-2 text-xs",
                            product.costPriceOre == null ? "text-warning" : "text-muted",
                          )}
                        >
                          {product.costPriceOre == null
                            ? t("delivery.unpriced")
                            : t("delivery.each", { price: kr(product.costPriceOre) })}
                        </span>
                      </span>
                      {/* Always there on a phone, which has no hover to reveal
                          it with — a control you can only get at with a pointer
                          is a control that does not exist on the screen this
                          sheet is actually filled in on. From md it goes back
                          to appearing with the row. */}
                      <button
                        type="button"
                        onClick={() => drop(id)}
                        className="shrink-0 rounded-md p-0.5 text-muted transition-opacity hover:text-foreground md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
                        aria-label={t("delivery.remove")}
                      >
                        <IconX className="size-4" />
                      </button>
                    </div>
                  </td>
                  <td className="p-0 align-middle">{cellFor(product)}</td>
                </tr>
              );
            })}
          </tbody>

          {/* The next line, the way a sheet always has one. It is also the only
              way onto an empty sheet, so it is never hidden — an empty state in
              its place would be a screen with no way in. */}
          <tbody className="border-t border-border">
            <tr className="divide-x divide-border">
              <td className="p-0 align-middle">
                {/* The two ways of putting a product on the sheet, side by
                    side, because they are one errand. The scanner is the
                    quicker of them and does double duty: a code already on the
                    sheet jumps to that row instead of adding a second one. */}
                <div className="flex items-center gap-1 pr-1">
                  <div className="min-w-0 flex-1">
                    <Combobox
                      value=""
                      onChange={add}
                      options={products
                        .filter((p) => !rows.includes(p.id))
                        .map((p) => ({ value: p.id, label: p.name }))}
                      onCreate={invent}
                      createLabel={(text) => t("delivery.newProduct", { name: text })}
                      placeholder={t("delivery.addProduct")}
                      searchPlaceholder={t("delivery.addSearch")}
                      aria-label={t("delivery.addProduct")}
                      align="left"
                      buttonClassName="h-10 w-full bg-transparent px-2 text-left text-sm text-muted focus-inset"
                    />
                  </div>
                  <IconButton
                    label={t("delivery.scan")}
                    title={t("delivery.scan")}
                    onClick={scan}
                  >
                    <IconScan className="size-4" />
                  </IconButton>
                </div>
              </td>
              <td />
            </tr>
          </tbody>
        </table>

        {/* The sheet is nothing until this is pressed, so the button says how
            much it is holding — a count is the one check that catches a row
            typed into the wrong line before it becomes a movement in the log.
            Sticky on a phone: a pallet runs past the bottom of the screen, and
            a save button you have to scroll to find is one people forget. */}
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-border bg-background px-inset py-3">
          <span className="text-sm text-muted">
            {pending_rows.length === 0
              ? t("delivery.nothingToSave")
              : t("delivery.unsaved", { count: pending_rows.length })}
          </span>
          <div className="flex items-center gap-2">
            {pending_rows.length > 0 && (
              <Button variant="secondary" onClick={discard} disabled={saving}>
                {t("delivery.discard")}
              </Button>
            )}
            <Button onClick={save} disabled={pending_rows.length === 0} loading={saving}>
              {t("delivery.save")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Said once, under the sheet: an unpriced product is not an error and
          the row books fine, but the shelf gains nothing for it and the total
          above is short by whatever it cost. */}
      {unpriced.length > 0 && <Notice tone="warning">{t("notice.noCostPrice")}</Notice>}

      {overlay}
    </PageShell>
  );
}
