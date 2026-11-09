"use client";

// One event as a sheet: three columns (ut, in, spill) and a row per product. A cell holds the night's total for that column,
// and leaving it writes the difference to the append-only log, so a mistake is fixed where it was made.
// A cell carries the total it was decided against and the server refuses it if the log has moved (lib/stock/cells.ts),
// so two phones in a cellar do not overwrite each other. Untouched cells are never sent.
// On a phone the three columns become one at a time, which keeps a row on one line.
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { EditableText } from "@/components/ui/editable-text";
import { Combobox } from "@/components/ui/combobox";
import { EmptyNote } from "@/components/ui/empty-state";
import { TableScroll } from "@/components/ui/table-scroll";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { SearchInput } from "@/components/ui/search-input";
import {
  IconDots,
  IconList,
  IconLock,
  IconScan,
  IconSwap,
  IconTrash,
  IconViewTable,
  IconX,
} from "@/components/ui/icons";
import { ViewToggle } from "@/components/ui/view-toggle";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useReturnTo } from "@/components/shell/route-history";
import { useConfirm } from "@/components/confirm-dialog";
import { useLocalDraft } from "@/lib/ui/use-local-draft";
import { useProductScan } from "@/components/stock/use-product-scan";
import { tagsInUse } from "@/lib/stock/tags";
import {
  CELL_KINDS,
  WHOLE,
  beforeTheNight,
  cellFault,
  cellKey,
  totalsFromCells,
  type CellKind,
} from "@/lib/stock/cells";
import { LEVELS, type BottleStock, type OpenBottles } from "@/lib/stock/levels";
import { isExpression, isQuantityInput, quantity } from "@/lib/stock/quantity";
import { useGridFocus, useSeekFocus } from "@/lib/ui/use-grid-focus";
import type { StockChangeDto, StockLevelDto, StockEventDetailDto } from "@/lib/data/stock";
import type { TagTotals } from "@/lib/stock/event";
import { ChangeFeed } from "@/components/stock/change-feed";
import { Bottle } from "@/components/stock/bottle-levels";
import { CategoryMark } from "@/components/stock/category-mark";
import { CATEGORIES } from "@/lib/domain/categories";
import type { PatchStockEvent, WriteStockCells } from "@/lib/api/schemas/stock";
import { cn } from "@/lib/ui/utils";
import { usePhone } from "@/lib/ui/media";
import { formatMovementLitres } from "@/lib/ui/format";

/** A figure in the product's own unit: litres for a spirit, a count otherwise. */
const amount = (kind: string, n: number): string =>
  kind === "VOLUME" ? formatMovementLitres(n) : String(n);

export default function EventClient({
  event,
  products,
  changes,
  canManage,
}: {
  event: StockEventDetailDto;
  products: StockLevelDto[];
  changes: StockChangeDto[];
  canManage: boolean;
}) {
  const t = useTranslations("stock");
  const router = useRouter();
  const phone = usePhone();
  const { pending, mutate } = useMutation();
  const confirm = useConfirm();
  const notify = useNotify();
  const returnTo = useReturnTo();

  // Only the cells somebody is typing in; everything else reads from the event. Kept in localStorage per event until saved, since it exists nowhere else.
  const [typed, setTyped, clearDraft] = useLocalDraft<Record<string, string>>(
    `stock:event:${event.id}:draft`,
    {},
  );
  /** What this page has written since the server last told it anything: `booked` is a cell's new figure, `shifted` what the cellar owes for it. Re-read on a refusal. */
  const [booked, setBooked] = useState<Record<string, number>>({});
  const [shifted, setShifted] = useState<Record<string, { units: number; open: OpenBottles }>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [column, setColumn] = useState<CellKind>("CHECKOUT");
  /** The sheet, or how its figures got there. See the page's collections. */
  const [view, setView] = useState<"sheet" | "changes">("sheet");
  const locale = useLocale();
  /** A product a scan has just put on the sheet, waiting for the caret. */
  const [seeking, setSeeking] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /** Which cell has the caret. A cell shows its working only while it does. */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** The row whose product is being changed: its name is a picker until chosen or called off. */
  const [swapping, setSwapping] = useState<string | null>(null);

  /** Every cell's input, so the keyboard can move between them. */
  const { focusCell, register, handleKey } = useGridFocus();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lineOf = useMemo(() => new Map(event.lines.map((l) => [l.productId, l])), [event.lines]);

  /** What every cell is booked at: the log, plus what this page has written. */
  const base = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of event.lines) {
      for (const [suffix, value] of Object.entries(line.cells)) {
        map.set(`${line.productId}|${suffix}`, value);
      }
    }
    for (const [key, value] of Object.entries(booked)) map.set(key, value);
    return map;
  }, [event.lines, booked]);

  /** What the cellar holds, less whatever this page has taken off it since. */
  function shelfFor(product: StockLevelDto): BottleStock {
    const since = shifted[product.id];
    if (!since) return { sealed: product.onHand.units, open: product.onHand.open };
    const open: OpenBottles = { ...product.onHand.open };
    for (const level of LEVELS) open[level] = (open[level] ?? 0) + (since.open[level] ?? 0);
    return { sealed: product.onHand.units + since.units, open };
  }

  // ── What is on the sheet ──
  // The products the night already touched in the event's order, then those added since. The sheet never takes one off:
  // a product with movements booked is part of what happened. The draft names added rows too, so anything typed shows after a reload.
  const drafted = Object.entries(typed)
    .filter(([, text]) => text.trim() !== "")
    .map(([key]) => key.split("|")[0]);
  const rows: string[] = [
    ...event.lines.map((l) => l.productId),
    ...[...added, ...drafted].filter(
      (id, i, all) => !lineOf.has(id) && byId.has(id) && all.indexOf(id) === i,
    ),
  ];

  /** The rows drawn, once the search has had its say. Narrowed for the eye only: `rows` is still the whole night. */
  const hunt = search.trim().toLowerCase();
  const found = hunt ? rows.filter((id) => byId.get(id)?.name.toLowerCase().includes(hunt)) : rows;

  /** The drawn rows by drink type in the order every stock screen keeps them. The keyboard grid is built from `shown`, so it walks rows in drawn order. */
  const rank = (id: string): number => {
    const at = CATEGORIES.indexOf(byId.get(id)?.category as (typeof CATEGORIES)[number]);
    return at === -1 ? CATEGORIES.length : at;
  };
  const shown = [...found].sort((a, b) => rank(a) - rank(b));
  const groups: [string, string[]][] = [];
  for (const id of shown) {
    const category = byId.get(id)?.category ?? "";
    const last = groups[groups.length - 1];
    if (last && last[0] === category) last[1].push(id);
    else groups.push([category, [id]]);
  }

  /** What the log says a cell is, as text. Nothing at all when it is nothing. */
  const bookedText = (key: string): string => {
    const n = base.get(key) ?? 0;
    return n === 0 ? "" : String(n);
  };

  const number = (key: string): number => {
    const text = typed[key];
    if (text === undefined) return base.get(key) ?? 0;
    if (text.trim() === "") return 0;
    const q = quantity(text);
    return q.ok ? q.value : (base.get(key) ?? 0);
  };

  /** Every cell as it currently reads, typing included, so a count typed into Ut unlocks In on the same keystroke. */
  const live = useMemo(() => {
    const map = new Map(base);
    for (const key of Object.keys(typed)) map.set(key, number(key));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, typed]);

  // ── Worked out once a render, not once a cell ──
  // They depend on the product, not the cell, and `lockOn` asks for every cell twice, so they are looked up per product.
  const shelves = new Map<string, BottleStock>();
  const nights = new Map<string, TagTotals>();
  for (const productId of rows) {
    const product = byId.get(productId);
    if (!product) continue;
    shelves.set(productId, shelfFor(product));
    nights.set(productId, totalsFromCells(product, productId, live));
  }

  const shelfOf = (product: StockLevelDto): BottleStock =>
    shelves.get(product.id) ?? shelfFor(product);

  const nightOf = (product: StockLevelDto): TagTotals =>
    nights.get(product.id) ?? totalsFromCells(product, product.id, live);

  /** How many of these the event had to take when it started, not what is on the shelf now: the ladder is measured against what the night found (see `beforeTheNight`). */
  const available = (product: StockLevelDto, level: number): number =>
    beforeTheNight(shelfOf(product), base, product.id, level);

  /** What a cell shows: the working (`24*10+30`) while focused, the answer otherwise (as in budget/[budgetId]/use-budget-cells.tsx). */
  const display = (key: string): string => {
    const raw = typed[key];
    if (raw === undefined) return bookedText(key);
    if (focusKey === key) return raw;
    if (raw.trim() === "") return "";
    const q = quantity(raw);
    // A sum that does not add up yet stays as typed.
    return q.ok ? String(q.value) : raw;
  };

  // ── What cannot be typed in at all ──
  // A lock says no figure could go here (this vodka had no 60 % bottles when the night began). A fault says that figure is too big, and the caret stays.
  // Never locked: a cell with something already booked (the figure must stay correctable) or one being worked in.
  type Lock = "nothingOnShelf" | "nothingOut";

  function lockOn(product: StockLevelDto, kind: CellKind, level: number): Lock | null {
    const key = cellKey({ productId: product.id, kind, level });
    if ((base.get(key) ?? 0) !== 0) return null;
    if (typed[key] !== undefined || focusKey === key) return null;
    if (kind === "CHECKOUT") {
      return available(product, level) === 0 ? "nothingOnShelf" : null;
    }
    // Nothing can come home or be dropped from a night that took nothing out. How much is unaccounted for is a fault, not a lock.
    return nightOf(product).out === 0 ? "nothingOut" : null;
  }

  /** A cell key, taken apart. */
  const refOf = (key: string) => {
    const [productId, kind, level] = key.split("|");
    return { productId, kind: kind as CellKind, level: Number(level) };
  };

  /** The cells somebody has typed a different figure into. */
  const changed = Object.keys(typed).filter(
    (key) => byId.has(refOf(key).productId) && number(key) !== (base.get(key) ?? 0),
  );

  /** Why a cell cannot hold what was typed. `cellFault` is the server's own rule. Keyed by cell, not product, so the cell you clear to fix a mess is not itself refused. */
  const faults = new Map<string, string>();
  for (const key of changed) {
    const ref = refOf(key);
    const product = byId.get(ref.productId);
    if (!product) continue;
    // `live`, not `base`: the night's arithmetic is about what the sheet says, and most of a sheet is unsaved for most of an evening.
    // The cellar half of the rule still reads `base`, since the shelf has moved for those rows only. See SheetState in lib/stock/cells.ts.
    const bad = cellFault(
      product,
      shelfOf(product),
      { sheet: live, booked: base },
      ref,
      number(key),
    );
    if (bad) faults.set(key, bad);
  }

  /** The first thing wrong with a product's cells, for the row to say. */
  const faultOn = (productId: string): string | undefined => {
    for (const [key, fault] of faults) if (refOf(key).productId === productId) return fault;
    return undefined;
  };

  // ── Typing ──
  function type(key: string, text: string) {
    if (!isQuantityInput(text)) return;
    setTyped((prev) => ({ ...prev, [key]: text }));
  }

  /**
   * Write everything typed as one request: the route applies the array of cells in one transaction (api/stock/events/[id]/cells/route.ts).
   * Every cell carries the figure it was decided against, so the server refuses if another phone has moved the row.
   * Cells the rule already refuses are held back, not sent.
   */
  async function save() {
    const cells = changed
      .filter((key) => !faults.has(key))
      .map((key) => {
        const ref = refOf(key);
        return { ...ref, expected: base.get(key) ?? 0, qty: number(key) };
      });
    if (cells.length === 0) return;

    const body: WriteStockCells = {
      occurredAt: event.date,
      cells: cells.map((c) => ({
        productId: c.productId,
        kind: c.kind,
        level: c.level as WriteStockCells["cells"][number]["level"],
        expected: c.expected,
        qty: c.qty,
      })),
    };
    const done = await mutate<{ written: number }>(`/api/stock/events/${event.id}/cells`, {
      key: "save",
      method: "POST",
      body,
      refresh: false,
      error: t("event.sheet.failed"),
    });

    if (!done) {
      // Refused, most often because another phone moved a cell. The draft is kept; re-reading makes the next attempt carry the right `expected`.
      setBooked({});
      setShifted({});
      router.refresh();
      return;
    }

    // Saved: the draft goes and the truth is re-read rather than reconstructed.
    setBooked({});
    setShifted({});
    clearDraft();
    router.refresh();
  }

  /** Throw away everything typed and not saved. Asked first: the draft is the only copy. */
  async function discard() {
    const ok = await confirm({
      title: t("event.sheet.discardTitle"),
      message: t("event.sheet.discardMessage", { count: changed.length }),
      confirmLabel: t("event.sheet.discard"),
      tone: "danger",
    });
    if (ok) clearDraft();
  }

  /**
   * Undo the night. The question changes with what is booked on it, as on the product page.
   * The draft goes too (localStorage under the event's id).
   */
  async function rename(raw: string) {
    const name = raw.trim();
    if (!name) {
      notify.error(t("event.field.nameRequired"));
      return false;
    }
    return patchEvent({ name, date: event.date });
  }
  async function patchEvent(body: PatchStockEvent) {
    const done = await mutate(`/api/stock/events/${event.id}`, {
      method: "PATCH",
      body,
      error: t("event.editFailed"),
      success: t("event.edited"),
    });
    return done !== null;
  }

  async function remove() {
    const ok = await confirm({
      title: t("event.removeTitle", { name: event.name }),
      message:
        event.entries > 0
          ? t("event.removeUsed", { count: event.entries, products: event.products })
          : t("event.removeDescription"),
      confirmLabel: t("event.remove"),
      tone: "danger",
    });
    if (!ok) return;
    const gone = await mutate<{ entries: number; products: number }>(
      `/api/stock/events/${event.id}`,
      { method: "DELETE", error: t("event.removeFailed") },
    );
    if (gone === null) return;
    clearDraft();
    // Counted by the transaction, not the page: somebody else may have booked in between.
    notify.success(
      gone.entries > 0 ? t("event.removedWithLog", { count: gone.entries }) : t("event.removed"),
    );
    // Not a push. The event is gone, and Back must not lead to its page.
    returnTo("/stock/events");
  }

  /** Take a product off the event: typed into the draft as zeros, so a booked product keeps its line until the next save. One only added here simply goes. */
  function drop(productId: string) {
    const product = byId.get(productId);
    if (!product) return;
    setTyped((prev) => {
      const next = { ...prev };
      for (const kind of CELL_KINDS) {
        for (const level of sheetLines(product)) {
          const key = cellKey({ productId, kind, level });
          // "" reads as a zero and books no row at all.
          if ((base.get(key) ?? 0) !== 0) next[key] = "";
          else delete next[key];
        }
      }
      return next;
    });
    setAdded((prev) => prev.filter((id) => id !== productId));
  }

  /**
   * The same row, a different product: the counts were never the mistake, so what was out, home and broken carry over, typed and saved alike.
   * Saved figures are zeroed on the old product and written on the new one (ordinary cells, one transaction).
   * Only between products of the same kind: a spirit's rungs have nowhere to go on a can.
   */
  function swap(fromId: string, toId: string) {
    const from = byId.get(fromId);
    if (!from || fromId === toId || !byId.has(toId)) return;

    // Read first, write second: reading `typed` and `base` inside the updater would read them out of the state React hands back.
    const moves = CELL_KINDS.flatMap((kind) =>
      sheetLines(from).map((level) => ({
        fromKey: cellKey({ productId: fromId, kind, level }),
        toKey: cellKey({ productId: toId, kind, level }),
        qty: number(cellKey({ productId: fromId, kind, level })),
      })),
    );

    setTyped((prev) => {
      const next = { ...prev };
      for (const { fromKey, toKey, qty } of moves) {
        // Clear the old one as `drop` does: "" where a row is booked, nothing where there never was one.
        if ((base.get(fromKey) ?? 0) !== 0) next[fromKey] = "";
        else delete next[fromKey];
        // The target is never already on the sheet (the picker only offers products that are not).
        if (qty > 0) next[toKey] = String(qty);
      }
      return next;
    });
    setAdded((prev) => {
      const without = prev.filter((id) => id !== fromId);
      return without.includes(toId) || lineOf.has(toId) ? without : [...without, toId];
    });
    setSwapping(null);
  }

  function add(productId: string) {
    if (!byId.has(productId)) return;
    setAdded((prev) => (prev.includes(productId) ? prev : [...prev, productId]));
    // Straight into the first box it can take: Ut for a new product, since In and Spill lock until something has gone out.
    setSeeking(productId);
  }

  // Scanning a barcode onto the sheet and inventing a product, shared with the delivery sheet.
  // A scan clears the search too, or a narrowed sheet would hide the row it just asked for.
  const { scan, invent, overlay } = useProductScan({
    unknownError: t("scan.unknown"),
    knownTags: tagsInUse(products),
    onScanned: (id) => {
      setSearch("");
      add(id);
      setSeeking(id);
    },
    onCreated: (id) => {
      add(id);
      setSeeking(id);
    },
  });

  // ── The grid ──
  // Same cell vocabulary as the voucher editor (components/voucher-editor.tsx): `divide-*` rules, a fixed layout, and `p-0` cells around a bare
  // full-height input so the focus ring lands on the cell.
  const headerCell = "px-2 py-2.5 text-center font-medium";
  /** How many columns a full-width row spans: all from md, the three that show on a phone. A span counts only displayed cells. */
  const span = phone ? 3 : CELL_KINDS.length + 2;
  const cellInput =
    "block h-10 w-full bg-transparent px-2 text-center text-sm tabular-nums placeholder:text-muted focus-inset";

  /**
   * The rows a product takes up: a can is one row, a spirit its name then one row per rung of its ladder.
   * All three columns are live on every row, spill included (a dropped bottle loses everything left in it).
   */
  const sheetLines = (product: StockLevelDto): number[] =>
    product.kind !== "VOLUME" ? [WHOLE] : [WHOLE, ...LEVELS];

  const rungName = (level: number): string =>
    level === WHOLE ? t("event.level.sealed") : t("event.level.rung", { level });

  // ── Walking the grid ──
  // A row per line of the sheet and a column per direction; locked cells and rows a search hid are holes. Movement is lib/ui/grid-nav.ts,
  // not the budget sheet's `use-cell-edit`, since tabbing here would pass each row's product link and remove button.
  const grid: (string | null)[][] = [];
  for (const productId of shown) {
    const product = byId.get(productId);
    if (!product) continue;
    for (const level of sheetLines(product)) {
      grid.push(
        CELL_KINDS.map((kind) =>
          lockOn(product, kind, level) ? null : cellKey({ productId, kind, level }),
        ),
      );
    }
  }

  /**
   * Put the caret in the first box a newly added product can take: Ut for a product new to the event (In and Spill lock
   * until something has gone out), else the column the phone shows. An effect, since the row appears a render after `add`.
   */
  // The row may appear after the add and again when the server sends a just-created product. See lib/ui/use-grid-focus.ts.
  // The first cell that will take the caret, walking the product's rungs then the three kinds.
  useSeekFocus(
    seeking,
    () => setSeeking(null),
    (productId) => {
      const product = byId.get(productId);
      if (!product) return false;
      for (const level of sheetLines(product)) {
        for (const kind of CELL_KINDS) {
          if (focusCell(cellKey({ productId, kind, level }))) return true;
        }
      }
      return false;
    },
    [products, added],
  );

  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, key: string) =>
    handleKey(e, key, grid, {
      // Three columns wide, and a cell can hold `24*10+30`.
      horizontal: true,
      onEscape: (k) => setTyped((prev) => ({ ...prev, [k]: bookedText(k) })),
    });

  // ── A cell ──
  // A function returning an input, not a component: one declared here is a new type each render and would drop focus on the first keystroke.
  function cellFor(product: StockLevelDto, kind: CellKind, level: number) {
    const lock = lockOn(product, kind, level);
    if (lock) {
      return (
        <span
          className="flex h-10 items-center justify-center text-muted"
          title={t(`event.sheet.locked.${lock}`)}
        >
          <IconLock className="size-3.5" />
          <span className="sr-only">{t(`event.sheet.locked.${lock}`)}</span>
        </span>
      );
    }

    const key = cellKey({ productId: product.id, kind, level });
    const raw = typed[key];
    const changed = raw !== undefined && number(key) !== (base.get(key) ?? 0);
    const working = raw !== undefined && focusKey !== key && isExpression(raw);
    return (
      <input
        ref={register(key)}
        inputMode="numeric"
        className={cn(
          cellInput,
          // A cell on its way to the log over one that merely holds working.
          changed ? "bg-warning-soft/60 font-medium" : working && "bg-accent-soft/40",
          pending === key && "text-muted",
        )}
        value={display(key)}
        title={working ? raw : undefined}
        placeholder="0"
        disabled={!canManage}
        // Arriving seeds the cell with what it says, so editing 120 to 100 is an edit.
        onFocus={(e) => {
          setFocusKey(key);
          setTyped((prev) =>
            prev[key] === undefined ? { ...prev, [key]: bookedText(key) } : prev,
          );
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => type(key, e.target.value)}
        onBlur={() => setFocusKey((k) => (k === key ? null : k))}
        onKeyDown={(e) => onCellKey(e, key)}
        aria-label={`${product.name} - ${t(`kind.${kind}`)}${
          product.kind === "VOLUME" ? ` - ${rungName(level)}` : ""
        }`}
      />
    );
  }

  // The night's date as people say it, weekday first.
  const longDate = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${event.date}T12:00:00`));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
    new Date(`${event.date}T12:00:00`),
  );

  return (
    <PageShell
      title={
        <EditableText
          value={event.name}
          label={t("event.rename")}
          placeholder={t("event.field.namePlaceholder")}
          disabled={!canManage}
          onSave={rename}
        />
      }
      subtitle={
        canManage ? (
          // The weekday stays in words beside the field.
          <>
            <span className="capitalize">{weekday}</span>{" "}
            <EditableText
              value={event.date}
              type="date"
              label={t("event.changeDate")}
              onSave={(date) => (date ? patchEvent({ name: event.name, date }) : false)}
            />
          </>
        ) : (
          longDate
        )
      }
      back="/stock/events"
      width="wide"
      // What applies to the whole night: how it is drawn and the menu of what is done to the night itself.
      aside={
        <>
          <ViewToggle
            aria-label={t("event.view.label")}
            value={view}
            options={[
              { value: "sheet", label: t("event.view.sheet"), icon: IconViewTable },
              { value: "changes", label: t("event.view.changes"), icon: IconList },
            ]}
            onChange={setView}
          />
          {canManage && (
            <Menu
              label={t("event.actions")}
              iconOnly
              variant="ghost"
              size="sm"
              icon={<IconDots className="size-4" />}
            >
              <MenuItem onClick={remove} className="text-danger hover:bg-danger-soft">
                <IconTrash className="size-4 shrink-0" />
                {t("event.remove")}
              </MenuItem>
            </Menu>
          )}
        </>
      }
    >
      {view === "changes" ? (
        <Card className="overflow-hidden">
          <ChangeFeed changes={changes} scope="event" />
          <div className="border-t border-border px-inset py-3">
            <Link
              href={`/stock/history?event=${event.id}`}
              className="text-sm font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
            >
              {t("event.movements", { count: event.entries })}
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex items-center gap-2 border-b border-border px-inset py-2">
              <div className="min-w-0 flex-1 sm:max-w-72">
                <SearchInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("event.sheet.search")}
                  aria-label={t("event.sheet.search")}
                />
              </div>
              {canManage && (
                <Button variant="secondary" onClick={scan} title={t("event.sheet.scan")}>
                  <IconScan className="size-4" />
                  <span className="hidden sm:inline">{t("event.sheet.scanShort")}</span>
                </Button>
              )}
            </div>
            <div className="border-b border-border px-inset md:hidden">
              <FilterTabs
                options={CELL_KINDS.map((kind) => ({ value: kind, label: t(`kind.${kind}`) }))}
                value={column}
                onChange={setColumn}
                fill
                aria-label={t("event.sheet.column")}
              />
            </div>

            {/* No CardBody: the sheet is ruled to the card's own edge, as in the voucher editor. */}
            {/* The spare rows are how a product gets onto the sheet, so an empty event still needs the table. */}
            {rows.length === 0 && !canManage ? (
              <div className="px-inset py-6">
                <EmptyNote>{t("event.nothing")}</EmptyNote>
              </div>
            ) : (
              /* Scrolls sideways only where needed: on a phone the three columns fit. */
              <TableScroll minWidth="min-w-0 md:min-w-[36rem]">
                {/* table-fixed: header percentages decide the columns, so a long name cannot push them. */}
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="divide-x divide-border border-b border-border bg-surface text-xs text-muted">
                      <th className={cn(headerCell, "w-[34%] text-left")}>
                        {t("event.col.product")}
                      </th>
                      {CELL_KINDS.map((kind) => (
                        <th
                          key={kind}
                          className={cn(
                            headerCell,
                            "w-[15%]",
                            kind !== column && "hidden md:table-cell",
                          )}
                        >
                          {t(`kind.${kind}`)}
                        </th>
                      ))}
                      <th className={cn(headerCell, "w-[21%]")}>{t("event.col.sold")}</th>
                    </tr>
                  </thead>

                  {groups.map(([category, ids]) => (
                    <Fragment key={category}>
                      <tbody>
                        <tr className="border-b border-border bg-surface/60">
                          <td colSpan={span} className="px-3 py-1.5">
                            <span className="flex items-center gap-2 text-xs font-medium text-muted">
                              <CategoryMark category={category as StockLevelDto["category"]} />
                              {t(`category.${category}`)}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                      {ids.map((productId) => {
                        const product = byId.get(productId);
                        if (!product) return null;
                        const totals = nightOf(product);
                        const fault = faultOn(productId);
                        const lines = sheetLines(product);
                        const isVolume = product.kind === "VOLUME";
                        const shelf = shelfOf(product);

                        return (
                          <tbody
                            key={productId}
                            className="divide-y divide-border/40 border-b border-border last:border-0"
                          >
                            {/* A spirit's own row carries its name and total, typing happens on the ladder below. A can's one row is both. */}
                            <tr className={cn("divide-x divide-border", isVolume && "bg-surface")}>
                              <td className="group px-2 py-1.5 align-middle">
                                <div className="flex items-center justify-between gap-2">
                                  {swapping === productId ? (
                                    // The name while it is being changed, in place: the row is where "which product is this" is answered.
                                    <div className="flex min-w-0 flex-1 items-center gap-1">
                                      <div className="min-w-0 flex-1">
                                        <Combobox
                                          autoFocus
                                          size="sm"
                                          value=""
                                          onChange={(toId) => swap(productId, toId)}
                                          // Never one already on the sheet (unique index on a cell) or one counted differently (a spirit's rungs have nowhere to land on a can).
                                          options={products
                                            .filter(
                                              (p) =>
                                                !rows.includes(p.id) && p.kind === product.kind,
                                            )
                                            .map((p) => ({
                                              value: p.id,
                                              label: p.name,
                                            }))}
                                          placeholder={t("event.sheet.swapTo")}
                                          searchPlaceholder={t("event.sheet.addSearch")}
                                          aria-label={t("event.sheet.swap")}
                                          align="left"
                                        />
                                      </div>
                                      <IconButton
                                        label={t("event.sheet.swapCancel")}
                                        onClick={() => setSwapping(null)}
                                      >
                                        <IconX className="size-4" />
                                      </IconButton>
                                    </div>
                                  ) : (
                                    // The name, and under it what the cellar holds, on separate lines so a long name does not shift the count.
                                    <span className="min-w-0">
                                      <Link
                                        href={`/stock/${productId}`}
                                        className="block truncate font-medium hover:underline"
                                      >
                                        {product.name}
                                      </Link>
                                      <span className="block truncate text-xs text-muted">
                                        {isVolume
                                          ? t("holding.volume", {
                                              sealed: shelf.sealed,
                                              open: LEVELS.reduce(
                                                (n, l) => n + (shelf.open[l] ?? 0),
                                                0,
                                              ),
                                            })
                                          : t("holding.unit", {
                                              units: shelf.sealed,
                                            })}
                                      </span>
                                      {fault && (
                                        <span className="block text-xs text-danger">
                                          {t(`fault.${fault}`)}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                  {/* Row-level actions in a menu, icon only: forty rows with a word each would bury the products. */}
                                  {canManage && swapping !== productId && (
                                    <Menu
                                      label={t("event.sheet.rowActions")}
                                      iconOnly
                                      variant="ghost"
                                      size="sm"
                                      icon={<IconDots className="size-4" />}
                                      className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:opacity-100"
                                    >
                                      <MenuItem onClick={() => setSwapping(productId)}>
                                        <IconSwap className="size-4 shrink-0 text-muted" />
                                        {t("event.sheet.swap")}
                                      </MenuItem>
                                      {/* Takes a product off the event entirely: removes its rows rather than zeroing them, since a wrong product is no movement. */}
                                      <MenuItem
                                        onClick={() => drop(productId)}
                                        className="text-danger hover:bg-danger-soft"
                                      >
                                        <IconTrash className="size-4 shrink-0" />
                                        {t("event.sheet.remove")}
                                      </MenuItem>
                                    </Menu>
                                  )}
                                </div>
                              </td>

                              {CELL_KINDS.map((kind) => (
                                <td
                                  key={kind}
                                  className={cn(
                                    "p-0 align-middle",
                                    kind !== column && "hidden md:table-cell",
                                  )}
                                >
                                  {!isVolume && cellFor(product, kind, lines[0])}
                                </td>
                              ))}

                              <td className="px-2 py-1.5 text-center align-middle font-medium tabular-nums">
                                {amount(product.kind, totals.sold)}
                              </td>
                            </tr>

                            {isVolume &&
                              lines.map((level) => (
                                <tr key={level} className="divide-x divide-border">
                                  {/* The rung as the bottle it stands for, and how many of those the night found on the shelf. */}
                                  <td className="py-1 pl-4 pr-2 align-middle">
                                    <span className="flex items-center gap-1.5 text-xs text-muted">
                                      <Bottle level={level === WHOLE ? 100 : level} />
                                      <span className="text-foreground">{rungName(level)}</span>
                                      <span className="ml-auto truncate tabular-nums">
                                        {t("event.sheet.onShelf", {
                                          count: available(product, level),
                                        })}
                                      </span>
                                    </span>
                                  </td>
                                  {CELL_KINDS.map((kind) => (
                                    <td
                                      key={kind}
                                      className={cn(
                                        "p-0 align-middle",
                                        kind !== column && "hidden md:table-cell",
                                      )}
                                    >
                                      {cellFor(product, kind, level)}
                                    </td>
                                  ))}
                                  <td />
                                </tr>
                              ))}
                          </tbody>
                        );
                      })}
                    </Fragment>
                  ))}

                  {/* Said inside the table so the spare rows below stay visible. */}
                  {shown.length === 0 && rows.length > 0 && (
                    <tbody>
                      <tr>
                        <td colSpan={span} className="px-inset py-4">
                          <EmptyNote>
                            {t("event.sheet.noMatch", {
                              text: search.trim(),
                            })}
                          </EmptyNote>
                        </td>
                      </tr>
                    </tbody>
                  )}

                  {/* The next line: typing a name puts that product on the event, and an unknown name offers to make it. One spare row, since the scanner is the quick way in. */}
                  {canManage && (
                    <tbody>
                      <tr className="divide-x divide-border">
                        <td className="p-0 align-middle">
                          {/* Picking by name. The scanner is on the toolbar: a code the event already has jumps to its row. */}
                          <div className="flex items-center">
                            <div className="min-w-0 flex-1">
                              <Combobox
                                value=""
                                onChange={add}
                                options={products
                                  .filter((p) => !rows.includes(p.id))
                                  .map((p) => ({
                                    value: p.id,
                                    label: p.name,
                                  }))}
                                onCreate={invent}
                                createLabel={(text) =>
                                  t("event.sheet.newProduct", {
                                    name: text,
                                  })
                                }
                                placeholder={t("event.sheet.addProduct")}
                                searchPlaceholder={t("event.sheet.addSearch")}
                                aria-label={t("event.sheet.addProduct")}
                                align="left"
                                buttonClassName="h-10 w-full bg-transparent px-2 text-left text-sm text-muted focus-inset"
                              />
                            </div>
                          </div>
                        </td>
                        {CELL_KINDS.map((kind) => (
                          <td
                            key={kind}
                            className={cn(kind !== column && "hidden md:table-cell")}
                          />
                        ))}
                        <td />
                      </tr>
                    </tbody>
                  )}
                </table>
              </TableScroll>
            )}

            {canManage && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-panel border-t border-border bg-background px-inset py-3">
                <span className="text-sm text-muted">
                  {changed.length === 0
                    ? t("event.sheet.nothingToSave")
                    : faults.size > 0
                      ? t("event.sheet.unsavedWithFaults", {
                          count: changed.length,
                          faults: faults.size,
                        })
                      : t("event.sheet.unsaved", { count: changed.length })}
                </span>
                <div className="flex items-center gap-2">
                  {changed.length > 0 && (
                    <Button variant="secondary" onClick={discard} disabled={pending !== null}>
                      {t("event.sheet.discard")}
                    </Button>
                  )}
                  {/* Faulty cells are skipped, so one bad figure cannot block the rest. */}
                  <Button
                    onClick={save}
                    disabled={changed.every((k) => faults.has(k))}
                    loading={pending === "save"}
                  >
                    {t("event.sheet.save")}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {overlay}
    </PageShell>
  );
}
