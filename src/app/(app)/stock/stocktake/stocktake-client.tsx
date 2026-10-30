"use client";

// The whole shelf, counted: a stocktake as a sheet.
//
// The per-product dialog (stock/product-actions.tsx, StocktakeDialog) is right
// for "the Fireball looks wrong", and the wrong shape entirely for the end of a
// term, when every product is counted: sixty products, sixty pages opened,
// sixty dialogs. The delivery sheet (stock/delivery) solved the same problem
// for a pallet, and this is its sibling. Every product on one page, grouped
// the way the shelves are, a box for what is there, and one button that books
// the lot.
//
// What is typed is what is on the shelf, never a difference, and the box is
// never pre-filled with what the log says: a stocktake whose expected figures
// are copied in is no stocktake (see StocktakeDialog). The log's figure stands
// beside the box instead, and the difference appears as soon as there is a
// count to compare it with.
//
// Only the products somebody counted are booked, and every one of those is,
// agreeing or not. A count that matches the log moves nothing, but it is the
// evidence that somebody looked, which is what an inspection asks for. The
// route writes it as such (recordStocktake in api/stock/entries).
//
// Kept in the browser as it is typed (lib/ui/use-local-draft.ts), because a
// stocktake is half an hour in a cellar on a phone that locks itself.
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ActionBar } from "@/components/action-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateInput, Field, Input } from "@/components/ui/field";
import { IconScan } from "@/components/ui/icons";
import { SearchInput } from "@/components/ui/search-input";
import { Tag } from "@/components/ui/status-pill";
import { TableScroll } from "@/components/ui/table-scroll";
import { CategoryMark } from "@/components/stock/category-mark";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useConfirm } from "@/components/confirm-dialog";
import { useLocalDraft } from "@/lib/ui/use-local-draft";
import { useProductScan } from "@/components/stock/use-product-scan";
import { tagsInUse } from "@/lib/stock/tags";
import { isQuantityInput, quantity } from "@/lib/stock/quantity";
import { LEVELS, bottlesAt, type Level } from "@/lib/stock/levels";
import type { StockLevelDto } from "@/lib/data/stock";
import type { CreateStockEntry } from "@/lib/api/schemas/stock";
import { cn } from "@/lib/ui/utils";

/** What has been typed and not yet booked, as typed. */
type Draft = {
  /** Sealed bottles, or units for a can, by product id. */
  sealed: Record<string, string>;
  /** Open bottles per level, by product id. Spirits and wine only. */
  open: Record<string, Partial<Record<Level, string>>>;
  occurredAt: string;
  note: string;
};

const DRAFT_KEY = "stock:stocktake:draft";

/** A box's figure: what was typed, worked out, or 0 for nothing. */
const figure = (text: string | undefined): number => {
  if (!text || text.trim() === "") return 0;
  const q = quantity(text);
  return q.ok ? q.value : 0;
};

export default function StocktakeClient({
  products,
  today,
}: {
  products: StockLevelDto[];
  today: string;
}) {
  const t = useTranslations("stock");
  const router = useRouter();
  const notify = useNotify();
  const confirm = useConfirm();
  const { mutate } = useMutation();
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [onlyDiffering, setOnlyDiffering] = useState(false);

  const [draft, setDraft, clearDraft] = useLocalDraft<Draft>(DRAFT_KEY, {
    sealed: {},
    open: {},
    occurredAt: today,
    note: "",
  });

  // A product counts as counted once its first box has something in it. The
  // open bottles of a spirit are optional on top: left empty they are none,
  // the same as in the dialog.
  const counted = (id: string) => (draft.sealed[id] ?? "").trim() !== "";

  const differences = (p: StockLevelDto) => {
    const sealed = figure(draft.sealed[p.id]) - p.onHand.units;
    const open = LEVELS.map(
      (l) => figure(draft.open[p.id]?.[l]) - bottlesAt(p.onHand.open, l),
    );
    return { sealed, open, any: sealed !== 0 || (p.kind === "VOLUME" && open.some((n) => n !== 0)) };
  };

  const countedProducts = products.filter((p) => counted(p.id));
  const differing = countedProducts.filter((p) => differences(p).any);
  // Counted with more sealed than the log: very often a delivery being booked
  // in the wrong place, which would bring the bottles in at the shelf's
  // average (often nothing) and leave them out of the restaurangrapport.
  const increases = countedProducts
    .map((p) => ({ p, n: differences(p).sealed }))
    .filter((x) => x.n > 0);

  /**
   * Hand the increases to the delivery sheet, as a delivery of that many of
   * each, and go there to book it. Written into that sheet's own draft
   * (stock/delivery, its DRAFT_KEY), added to whatever it already holds. This
   * sheet keeps its counts: once the delivery is booked they agree with the
   * log, and are booked as the evidence of the count they are.
   */
  function increasesToDelivery() {
    try {
      const key = "stock:delivery:draft";
      const raw = window.localStorage.getItem(key);
      const d = raw
        ? (JSON.parse(raw) as { rows: string[]; typed: Record<string, string>; occurredAt?: string; note?: string })
        : { rows: [], typed: {}, occurredAt: draft.occurredAt, note: "" };
      for (const { p, n } of increases) {
        if (!d.rows.includes(p.id)) d.rows.push(p.id);
        d.typed[p.id] = String(n);
      }
      d.occurredAt ??= draft.occurredAt;
      window.localStorage.setItem(key, JSON.stringify(d));
    } catch {
      notify.error(t("stocktakeSheet.toDeliveryFailed"));
      return;
    }
    router.push("/stock/delivery");
  }

  // The shelves, in the order the list keeps them: by drink type, then name.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = products.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || p.ean?.includes(q)) &&
        (!onlyDiffering || (counted(p.id) && differences(p).any)),
    );
    const by = new Map<string, StockLevelDto[]>();
    for (const p of shown) by.set(p.category, [...(by.get(p.category) ?? []), p]);
    return [...by.entries()];
    // `counted` and `differences` read the draft, which is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, onlyDiffering, draft]);

  // Each product's first box, so a scan can put the caret in it.
  const boxes = useRef(new Map<string, HTMLInputElement | null>());
  const jumpTo = (id: string) => {
    setQuery("");
    setOnlyDiffering(false);
    // After the list has re-rendered unfiltered.
    requestAnimationFrame(() => {
      const box = boxes.current.get(id);
      box?.scrollIntoView({ block: "center", behavior: "smooth" });
      box?.focus({ preventScroll: true });
    });
  };
  const { scan, overlay } = useProductScan({
    unknownError: t("scan.unknown"),
    knownTags: tagsInUse(products),
    onScanned: jumpTo,
  });

  const typeSealed = (id: string, text: string) => {
    if (!isQuantityInput(text)) return;
    setDraft((d) => ({ ...d, sealed: { ...d.sealed, [id]: text } }));
  };
  const typeOpen = (id: string, level: Level, text: string) => {
    if (!isQuantityInput(text)) return;
    setDraft((d) => ({ ...d, open: { ...d.open, [id]: { ...d.open[id], [level]: text } } }));
  };

  /**
   * Book every counted product, one COUNT each, through the same route the
   * dialog uses. One at a time for the reason the delivery sheet gives: each
   * write replays that product's log. What the server refuses stays on the
   * sheet with its figures; what went through is cleared, so pressing again
   * sends only what is still owed.
   */
  async function save() {
    if (countedProducts.length === 0 || saving) return;
    setSaving(true);
    const written: string[] = [];
    try {
      for (const p of countedProducts) {
        const body: CreateStockEntry = {
          productId: p.id,
          kind: "COUNT",
          occurredAt: draft.occurredAt,
          counted: {
            sealed: figure(draft.sealed[p.id]),
            open:
              p.kind === "VOLUME"
                ? Object.fromEntries(LEVELS.map((l) => [String(l), figure(draft.open[p.id]?.[l])]))
                : undefined,
          },
          note: draft.note.trim() || undefined,
        };
        const made = await mutate<{ id: string }>("/api/stock/entries", {
          key: "save",
          method: "POST",
          body,
          refresh: false,
          error: t("stocktakeSheet.failed", { name: p.name }),
        });
        if (!made) break;
        written.push(p.id);
      }
    } finally {
      setSaving(false);
    }
    if (written.length === 0) return;

    const done = new Set(written);
    setDraft((d) => ({
      ...d,
      sealed: Object.fromEntries(Object.entries(d.sealed).filter(([id]) => !done.has(id))),
      open: Object.fromEntries(Object.entries(d.open).filter(([id]) => !done.has(id))),
    }));
    notify.success(t("stocktakeSheet.saved", { count: written.length }));
    router.refresh();
  }

  async function discard() {
    const ok = await confirm({
      title: t("stocktakeSheet.discardTitle"),
      message: t("stocktakeSheet.discardMessage", { count: countedProducts.length }),
      confirmLabel: t("delivery.discard"),
      tone: "danger",
    });
    if (ok) clearDraft();
  }

  // The delivery sheet's cells: the grid lines are the boxes.
  const head = "px-2 py-2.5 text-center font-medium";
  const cell =
    "block h-10 w-full bg-transparent px-2 text-center text-sm tabular-nums placeholder:text-muted focus-inset";

  return (
    <PageShell title={t("stocktakeSheet.title")} back="/stock" width="content">
      <Card>
        <div className="grid gap-4 px-inset py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label={t("field.date")} requirement="required">
            <DateInput
              value={draft.occurredAt}
              onChange={(e) => setDraft((d) => ({ ...d, occurredAt: e.target.value }))}
            />
          </Field>
          <Field label={t("field.note")} requirement="optional">
            <Input
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              placeholder={t("stocktakeSheet.notePlaceholder")}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-inset py-3">
          <div className="min-w-0 flex-1">
            <SearchInput
              placeholder={t("stocktakeSheet.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={scan}>
            <IconScan className="size-4" />
            {t("scan.action")}
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={onlyDiffering}
              onChange={(e) => setOnlyDiffering(e.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
            {t("stocktakeSheet.onlyDiffering")}
          </label>
        </div>
      </Card>

      {/* One table, the delivery sheet's shape: a heading row, cells
          without boxes of their own, the drink types as dividers in it. It
          was a card per drink type with a small uppercase heading each, and
          rows whose names, labels and boxes wrapped each their own way. */}
      <Card className="overflow-hidden">
        <TableScroll minWidth="min-w-[42rem]">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="divide-x divide-border border-b border-border bg-surface text-xs text-muted">
                <th className={cn(head, "w-[30%] text-left")}>{t("stocktakeSheet.col.product")}</th>
                <th className={cn(head, "w-[15%] text-right")}>{t("stocktakeSheet.col.log")}</th>
                <th className={cn(head, "w-[12%]")}>{t("stocktakeSheet.col.sealed")}</th>
                {LEVELS.map((l) => (
                  <th key={l} className={cn(head, "w-[7%]")}>
                    {l} %
                  </th>
                ))}
                <th className={cn(head, "w-[15%] text-right")}>{t("stocktakeSheet.col.difference")}</th>
              </tr>
            </thead>
            {groups.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted">
                    {t("stocktakeSheet.noMatch")}
                  </td>
                </tr>
              </tbody>
            )}
            {groups.map(([category, rows]) => (
              <tbody key={category}>
                <tr className="border-b border-border bg-surface/60">
                  <td colSpan={8} className="px-3 py-1.5">
                    <span className="flex items-center gap-2 text-xs font-medium text-muted">
                      <CategoryMark category={category as StockLevelDto["category"]} />
                      {t(`category.${category}`)}
                    </span>
                  </td>
                </tr>
                {rows.map((p) => {
                  const volume = p.kind === "VOLUME";
                  const isCounted = counted(p.id);
                  const diff = differences(p);
                  const expectedOpen = LEVELS.filter((l) => bottlesAt(p.onHand.open, l) > 0)
                    .map((l) => t("stocktakeSheet.openAt", { count: bottlesAt(p.onHand.open, l), level: l }))
                    .join(", ");
                  return (
                    <tr
                      key={p.id}
                      className={cn("divide-x divide-border border-b border-border last:border-b-0", isCounted && "bg-accent-soft/20")}
                    >
                      <td className="truncate px-3 py-2 font-medium" title={p.name}>
                        {p.name}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted">
                        <span className="block">
                          {t("stocktakeSheet.logSealed", {
                            count: p.onHand.units,
                            unit: volume ? t("stocktakeSheet.sealedShort") : t("stocktakeSheet.unitsShort"),
                          })}
                        </span>
                        {expectedOpen && <span className="block text-xs">{expectedOpen}</span>}
                      </td>
                      <td className="p-0 align-middle">
                        <input
                          ref={(el) => {
                            boxes.current.set(p.id, el);
                          }}
                          inputMode="numeric"
                          value={draft.sealed[p.id] ?? ""}
                          onChange={(e) => typeSealed(p.id, e.target.value)}
                          placeholder="-"
                          aria-label={t("stocktakeSheet.countFor", { name: p.name })}
                          className={cn(cell, isCounted && "bg-warning-soft/40 font-medium")}
                        />
                      </td>
                      {LEVELS.map((l) =>
                        volume ? (
                          <td key={l} className="p-0 align-middle">
                            <input
                              inputMode="numeric"
                              value={draft.open[p.id]?.[l] ?? ""}
                              onChange={(e) => typeOpen(p.id, l, e.target.value)}
                              placeholder="0"
                              aria-label={t("stocktakeSheet.openFor", { name: p.name, level: l })}
                              className={cn(cell, (draft.open[p.id]?.[l] ?? "") !== "" && "bg-warning-soft/40 font-medium")}
                            />
                          </td>
                        ) : (
                          // A can is never opened on the shelf: nothing to count.
                          <td key={l} className="bg-surface/50" aria-hidden />
                        ),
                      )}
                      <td className="px-2 py-2 text-right">
                        {isCounted &&
                          (diff.any ? (
                            <Tag
                              tone="warning"
                              size="sm"
                              className="tabular-nums"
                              title={diff.sealed > 0 ? t("stocktakeSheet.increaseHint") : undefined}
                            >
                              {diff.sealed !== 0
                                ? `${diff.sealed > 0 ? "+" : "−"}${Math.abs(diff.sealed)}`
                                : t("stocktakeSheet.openDiffers")}
                            </Tag>
                          ) : (
                            <Tag tone="success" size="sm">
                              {t("stocktakeSheet.agrees")}
                            </Tag>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </TableScroll>
      </Card>

      <ActionBar
        summary={
          <span className="font-medium">
            {t("stocktakeSheet.progress", { counted: countedProducts.length, total: products.length })}
          </span>
        }
        missing={[]}
        missingLabel=""
        note={
          increases.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-warning">
              <span>{t("stocktakeSheet.increases", { count: increases.length })}</span>
              <button
                type="button"
                onClick={increasesToDelivery}
                className="font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current"
              >
                {t("stocktakeSheet.toDelivery")}
              </button>
            </div>
          ) : differing.length > 0 ? (
            <p className="text-xs text-warning">
              {t("stocktakeSheet.differing", { count: differing.length })}
            </p>
          ) : undefined
        }
        onSave={discard}
        saveLabel={t("delivery.discard")}
        saveDisabled={countedProducts.length === 0 || saving}
        saving={false}
        submit={{
          label: t("stocktakeSheet.save", { count: countedProducts.length }),
          onClick: save,
          disabled: countedProducts.length === 0,
          loading: saving,
        }}
      />

      {overlay}
    </PageShell>
  );
}
