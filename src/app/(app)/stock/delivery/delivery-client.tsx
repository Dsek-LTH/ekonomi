"use client";

// A delivery as a sheet: one row per product and how many came in, for a pallet of many products (the per-product form is in product-actions.tsx).
// Same vocabulary as the event sheet (stock/events/[id]/event-client.tsx) with two columns, since everything bought arrives sealed:
// the route refuses a delivery that moved a rung (`entryFault`, "purchaseArrivesSealed").
// Unlike the event sheet nothing is booked until Spara, since a pallet is checked against its invoice total first. The draft is kept in the browser (see `Draft`).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { tagsInUse } from "@/lib/stock/tags";
import { isExpression, isQuantityInput, quantity } from "@/lib/stock/quantity";
import { useGridFocus, useSeekFocus } from "@/lib/ui/use-grid-focus";
import type { StockLevelDto } from "@/lib/data/stock";
import type { CreateStockEntry } from "@/lib/api/schemas/stock";
import { cn } from "@/lib/ui/utils";
import { formatOreKr } from "@/lib/ui/format";

/** The sheet as it stands, unsent, stored as one object in localStorage (lib/ui/use-local-draft.ts). Quantities are the typed text (`24*10+30`), not resolved numbers. */
type Draft = {
  /** The products on the sheet, in the order they were put there. */
  rows: string[];
  /** What is in each row's box, keyed by product id. */
  typed: Record<string, string>;
  occurredAt: string;
  /** What the delivery was bought for, "Höstsittningen": free text written onto every row as its note. Not a StockEvent link, since an `eventId` enters that night's arithmetic (`stock.eventOnNightOnly`). */
  note: string;
};

/** Its own key, so a draft cannot be read back onto a different screen. */
const DRAFT_KEY = "stock:delivery:draft";

export default function DeliveryClient({
  products,
  today,
}: {
  products: StockLevelDto[];
  /** Today in Stockholm, decided by the server. See the page. */
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
  // The caret's own layer, shared with the stocktake sheet.
  const { focusCell, register, handleKey } = useGridFocus();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // ── What a cell says ──
  // `number` is what would be written, `display` what is on screen: a cell shows its working while focused and the answer otherwise (lib/stock/quantity.ts).
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
    // A sum that does not add up yet stays as typed.
    return q.ok ? String(q.value) : raw;
  };

  const type = (id: string, text: string) => {
    if (!isQuantityInput(text)) return;
    setTyped((prev) => ({ ...prev, [id]: text }));
  };

  // ── What the pallet comes to ──
  // Priced from the product, which is what the route values it at (lib/stock/value.ts), so it should match the invoice.
  const totalOre = rows.reduce(
    (sum, id) => sum + (byId.get(id)?.costPriceOre ?? 0) * number(id),
    0,
  );
  const unpriced = rows.filter((id) => byId.get(id)?.costPriceOre == null);

  // ── Booking ──

  /** The rows that would be written: a product and a positive count. */
  const pending_rows = rows
    .map((id) => ({ id, qty: number(id) }))
    .filter((r) => r.qty > 0 && byId.has(r.id));

  /**
   * Write the whole sheet: one PURCHASE of sealed units per product through the per-product route, sequentially,
   * since each delivery replays that product's log (`replayProduct`). Rows the server refuses stay in the draft, booked ones are removed.
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
        // `mutate` has already said what went wrong. Stop: whatever refused this row will likely refuse the next.
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
    // Only now: the shelf figures and product list are out of date once something is written.
    router.refresh();
  }

  /** Throw the whole sheet away. Asked first, since the draft is the only copy. */
  async function discard() {
    const ok = await confirm({
      title: t("delivery.discardTitle"),
      message: t("delivery.discardMessage", { count: pending_rows.length }),
      confirmLabel: t("delivery.discard"),
      tone: "danger",
    });
    if (ok) clearDraft();
  }

  /** Take a product off the sheet. Nothing is written yet, so this only forgets what was typed. */
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
    // Straight into the box.
    setSeeking(id);
  }

  // Scanning a barcode onto the sheet and inventing a product, shared with the stocktake event.
  const { scan, invent, overlay } = useProductScan({
    unknownError: t("scan.unknown"),
    knownTags: tagsInUse(products),
    onScanned: (id) => add(id),
  });

  // ── Walking the sheet ──
  // Enter down a column of counts, rather than the browser's tab order through each row's link and remove button (lib/ui/grid-nav.ts).
  const grid: (string | null)[][] = rows.map((id) => [id]);

  // The row may appear after the add, and again when a just-created product arrives (lib/ui/use-grid-focus.ts).
  useSeekFocus(seeking, () => setSeeking(null), focusCell, [products, rows]);

  // One column, so left/right stay with the text.
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, id: string) =>
    handleKey(e, id, grid, { onEscape: (k) => setTyped((prev) => ({ ...prev, [k]: "" })) });

  // ── A cell ──
  // A function returning an input, not a component: one declared here is a new type each render and would drop focus on the first keystroke.
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
          "block h-10 w-full bg-transparent px-2 text-center text-sm tabular-nums placeholder:text-muted focus-inset",
          changed ? "bg-warning-soft/60 font-medium" : working && "bg-accent-soft/40",
        )}
        value={display(id)}
        title={working ? raw : undefined}
        placeholder="0"
        // Arriving seeds the cell with what it says, so correcting 200 to 20 is an edit.
        onFocus={(e) => {
          setFocusKey(id);
          setTyped((prev) => (prev[id] === undefined ? { ...prev, [id]: "" } : prev));
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => type(id, e.target.value)}
        onBlur={() => setFocusKey((k) => (k === id ? null : k))}
        onKeyDown={(e) => onCellKey(e, id)}
        aria-label={`${product.name} - ${t("delivery.col.in")}`}
      />
    );
  }

  const headerCell = "px-2 py-2.5 text-center font-medium";

  // The buttons that book or discard, drawn in the summary card from lg and the sheet's footer below it (only one on screen).
  const saveStatus =
    pending_rows.length === 0
      ? t("delivery.nothingToSave")
      : t("delivery.unsaved", { count: pending_rows.length });
  const saveButtons = (
    <div className="flex items-center gap-2">
      {pending_rows.length > 0 && (
        <Button variant="secondary" onClick={discard} disabled={saving}>
          {t("delivery.discard")}
        </Button>
      )}
      <Button
        onClick={save}
        disabled={pending_rows.length === 0}
        loading={saving}
        className="flex-1"
      >
        {t("delivery.save")}
      </Button>
    </div>
  );

  return (
    <PageShell title={t("delivery.title")} back="/stock" width="wide">
      {/* Summary beside the sheet from lg (sticky). Below lg it stacks above with two fields, and the total and Spara ride the sheet's sticky footer. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <Card className="w-full shrink-0 lg:sticky lg:top-14 lg:order-2 lg:w-72">
          <div className="grid gap-3 px-inset py-4 sm:grid-cols-2 lg:grid-cols-1">
            <Field label={t("delivery.forLabel")} requirement="optional">
              <Input
                size="sm"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("delivery.forPlaceholder")}
              />
            </Field>
            <Field label={t("field.date")} requirement="required">
              <DateInput
                size="sm"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            </Field>
          </div>
          <div className="hidden space-y-3 border-t border-border px-inset py-4 lg:block">
            <div>
              <div className="text-xs text-muted">{t("delivery.total")}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {formatOreKr(totalOre, { decimals: 2 })}
              </div>
              <div className="mt-1 text-sm text-muted">{saveStatus}</div>
            </div>
            {saveButtons}
          </div>
        </Card>

        <Card className="min-w-0 flex-1 lg:order-1">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="divide-x divide-border border-b border-border bg-surface text-xs text-muted">
                <th className={cn(headerCell, "w-[40%] text-left")}>{t("delivery.col.product")}</th>
                {/* Columns of their own: the figures are read down against an invoice. */}
                <th className={cn(headerCell, "w-[19%] text-right")}>{t("delivery.col.price")}</th>
                <th className={cn(headerCell, "w-[17%]")}>{t("delivery.col.in")}</th>
                <th className={cn(headerCell, "w-[24%] text-right")}>{t("delivery.col.sum")}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/40">
              {rows.map((id) => {
                const product = byId.get(id);
                if (!product) return null;
                const qty = number(id);
                return (
                  <tr key={id} className="divide-x divide-border">
                    <td className="group px-2 py-1.5 align-middle">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <Link href={`/stock/${id}`} className="font-medium hover:underline">
                            {product.name}
                          </Link>
                        </span>
                        {/* Always visible on a phone, which has no hover; from md it appears with the row. */}
                        <button
                          type="button"
                          onClick={() => drop(id)}
                          className="shrink-0 rounded-control p-0.5 text-muted transition-opacity hover:text-foreground md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
                          aria-label={t("delivery.remove")}
                        >
                          <IconX className="size-4" />
                        </button>
                      </div>
                    </td>
                    {/* Text, not a disabled box: the price is the product's own figure. A product nobody has priced says so in the warning colour. */}
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right text-xs tabular-nums",
                        product.costPriceOre == null ? "text-warning" : "text-muted",
                      )}
                    >
                      {product.costPriceOre == null
                        ? t("delivery.unpriced")
                        : formatOreKr(product.costPriceOre, {
                            decimals: 2,
                          })}
                    </td>
                    <td className="p-0 align-middle">{cellFor(product)}</td>
                    {/* The line as the invoice prints it (price times count), blank until there is a count. */}
                    <td className="px-2 py-1.5 text-right text-sm tabular-nums">
                      {qty > 0 && product.costPriceOre != null
                        ? formatOreKr(product.costPriceOre * qty, {
                            decimals: 2,
                          })
                        : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* The only way onto an empty sheet, so never hidden. */}
            <tbody className="border-t border-border">
              <tr className="divide-x divide-border">
                <td colSpan={4} className="p-0 align-middle">
                  {/* Scanning a code already on the sheet jumps to its row instead of adding a second one. */}
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
              </tr>
            </tbody>
          </table>

          {/* Below lg, where the summary is above the sheet: the total and Spara stay with the rows, sticky. */}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-panel border-t border-border bg-background px-inset py-3 lg:hidden">
            <span className="text-sm text-muted">{saveStatus}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-baseline gap-2">
                <span className="text-xs text-muted">{t("delivery.total")}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatOreKr(totalOre, { decimals: 2 })}
                </span>
              </span>
              {saveButtons}
            </div>
          </div>
        </Card>
      </div>

      {/* An unpriced product books fine, but the shelf gains nothing for it and the total is short. */}
      {unpriced.length > 0 && <Notice tone="warning">{t("notice.noCostPrice")}</Notice>}

      {overlay}
    </PageShell>
  );
}
