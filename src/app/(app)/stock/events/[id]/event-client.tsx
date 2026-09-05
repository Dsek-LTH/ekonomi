"use client";

// One event, as a sheet.
//
// Three columns (ut, in, spill) and a row per product. A cell holds what the
// night's column comes to: the out cell of a beer carried out twice says 168,
// and typing 100 over it is how a mistake gets fixed. Leaving the cell writes
// the difference to the log, which is still the only record there is.
//
// A grid of totals sitting on an append-only ledger, and it buys two things
// worth the machinery. The arithmetic is visible where it is entered: `sold`
// is on the same row as the three figures it comes from, and moves as they are
// typed. And a mistake is fixable in the place it was made, rather than leaving
// somebody to construct a compensating entry by hand.
//
// Nothing is confirmed. A cell commits when you leave it, the way the budget
// sheet's do, and for the same reason: a sheet with a save button is a sheet
// that can be half filled in and abandoned, and this one is filled in standing
// in a cellar on a phone that locks itself. What is on the screen is what is in
// the log, always, so there is no draft to lose and nothing to remember to
// press. It also means the correction path and the entry path are one path,
// which is the whole reason the cells hold totals.
//
// Written optimistically: apply, tell the server, re-read only if refused (see
// `commitCell`). A refresh per cell would be a round trip whose entire result
// is a figure already on the screen, forty times over while somebody tabs down
// a column.
//
// Two people in a cellar have two screens, so a cell carries the total it was
// decided against and the server refuses it if the log has moved. See
// lib/stock/cells.ts. Untouched cells are never sent and never copied into
// state, so somebody else's work shows up here rather than being overwritten.
//
// On a phone the three columns become one at a time. Same sheet, same cells;
// what changes is that a row is a product and a number rather than a product
// and three. That matches the errand, since you are carrying crates one
// direction at a time, and it is the only arrangement that keeps a row on one line without
// asking anybody to drag a grid sideways in a cellar.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { EmptyNote } from "@/components/ui/empty-state";
import { TableScroll } from "@/components/ui/table-scroll";
import { IconButton } from "@/components/ui/icon-button";
import {
  IconDots,
  IconElbow,
  IconLock,
  IconScan,
  IconSwap,
  IconTrash,
  IconX,
} from "@/components/ui/icons";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useReturnTo } from "@/components/shell/route-history";
import { useConfirm } from "@/components/confirm-dialog";
import { useLocalDraft } from "@/lib/ui/use-local-draft";
import { useProductScan } from "@/components/stock/use-product-scan";
import { tagsInUse } from "@/lib/stock/tags";
import { SheetHeader, SheetSaveBar } from "./sheet-chrome";
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
import { useGridFocus } from "@/lib/ui/use-grid-focus";
import type { StockChangeDto, StockLevelDto, StockEventDetailDto } from "@/lib/data/stock";
import type { TagTotals } from "@/lib/stock/event";
import { ChangeFeed } from "@/components/stock/change-feed";
import type { WriteStockCells } from "@/lib/api/schemas/stock";
import { cn } from "@/lib/ui/utils";

/** A figure in the product's own unit: litres for a spirit, a count otherwise. */
const amount = (kind: string, n: number): string =>
  kind === "VOLUME"
    ? `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(n / 1000)} l`
    : String(n);

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
  const { pending, mutate } = useMutation();
  const confirm = useConfirm();
  const notify = useNotify();
  const returnTo = useReturnTo();

  // Only the cells somebody is typing in. Everything else reads from the event,
  // so a cell nobody has touched shows what is booked, including what the
  // other phone in the cellar booked, rather than a copy of it.
  //
  // Kept in localStorage, keyed by the event, until it is saved: a night is
  // filled in over an evening on a phone that locks itself, and what has been
  // typed and not yet sent is the one thing on this screen that exists nowhere
  // else. Per event, so two events cannot read back each other's work.
  const [typed, setTyped, clearDraft] = useLocalDraft<Record<string, string>>(
    `stock:event:${event.id}:draft`,
    {},
  );
  /**
   * What this page has written since the server last told it anything.
   *
   * The optimistic path's memory: `booked` is the new figure for a cell and
   * `shifted` is what the cellar owes for it. Both are thrown away and re-read
   * the moment the server refuses something, because from then on the screen is
   * ahead of the log and no longer knows by how much.
   */
  const [booked, setBooked] = useState<Record<string, number>>({});
  const [shifted, setShifted] = useState<Record<string, { units: number; open: OpenBottles }>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [column, setColumn] = useState<CellKind>("CHECKOUT");
  const [occurredAt, setOccurredAt] = useState(event.date);
  /** A product a scan has just put on the sheet, waiting for the caret. */
  const [seeking, setSeeking] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /** Which cell has the caret. A cell shows its working only while it does. */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** The row whose product is being changed: its name is a picker until it is
   *  chosen or the change is called off. */
  const [swapping, setSwapping] = useState<string | null>(null);

  /** Every cell's input, so the keyboard can move between them. */
  // The caret's own layer: the map of cell → input, and the keys that move it.
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
  //
  // The products the night has already touched, in the order the event lists
  // them, then whatever has been added since. Nothing is ever taken off by the
  // sheet: a product with movements booked on it is part of what happened.
  //
  // "Added since" is two things, and it used to be one. `added` is this
  // screen's own list, which a reload throws away, but the figures typed into
  // those rows live in the draft and survive it. A product picked onto the
  // sheet and filled in before the phone locked itself came back with no row
  // at all: the counts were still in localStorage, still on their way to the
  // log on the next save, and nowhere on the screen. So the draft names rows
  // too, and anything typed is somewhere to be seen and corrected.
  const drafted = Object.entries(typed)
    .filter(([, text]) => text.trim() !== "")
    .map(([key]) => key.split("|")[0]);
  const rows: string[] = [
    ...event.lines.map((l) => l.productId),
    ...[...added, ...drafted].filter(
      (id, i, all) => !lineOf.has(id) && byId.has(id) && all.indexOf(id) === i,
    ),
  ];

  /**
   * The rows actually drawn, once the search has had its say.
   *
   * Narrowed for the eye only: `rows` above is still the whole night, so the
   * figures, the locks and what gets written are unaffected by whatever is
   * typed up here. A night that takes out thirty different things is a lot to
   * scroll past when you are holding one of them.
   */
  const hunt = search.trim().toLowerCase();
  const shown = hunt
    ? rows.filter((id) => byId.get(id)?.name.toLowerCase().includes(hunt))
    : rows;

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

  /**
   * Every cell as it currently reads, typing included.
   *
   * What the row's figures and the locks are worked out from, so a count typed
   * into Ut unlocks In on the same keystroke rather than a round trip later.
   */
  const live = useMemo(() => {
    const map = new Map(base);
    for (const key of Object.keys(typed)) map.set(key, number(key));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, typed]);

  // ── Worked out once a render, not once a cell ──
  //
  // Both of these used to be recomputed inside `lockOn`, which every cell of
  // the sheet asks, twice, once to draw itself and once to take its place in
  // the keyboard's order. Forty products with a spirit's ladder each is well
  // over a thousand folds of the same handful of numbers per keystroke, and the
  // sheet felt it. They depend on the product and not on the cell, so they are
  // worked out per product and looked up.
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

  /**
   * How many of these the event had to take, when it started.
   *
   * Not what is on the shelf now, because the sheet has been changing that. Two
   * bottles brought back at 60 % put a 60 % rung in the cellar, and offering
   * them straight back to the same night is both confusing and pointless: out
   * and back and out again comes to the same millilitres as out and never
   * returned. So the ladder is measured against what the night found, and stays
   * put while it is filled in. See `beforeTheNight`.
   */
  const available = (product: StockLevelDto, level: number): number =>
    beforeTheNight(shelfOf(product), base, product.id, level);

  /**
   * What a cell shows.
   *
   * The working while the caret is in it, the answer the rest of the time:
   * `24*10+30` under the caret, `270` once you leave. Borrowed from the budget
   * sheet's formula cells (budget/[budgetId]/use-budget-cells.tsx), and for the
   * same reason: the sum is how somebody got there and the total is what they
   * meant, and a cell keeping only one of them makes you choose between
   * checking the arithmetic and reading the figure.
   */
  const display = (key: string): string => {
    const raw = typed[key];
    if (raw === undefined) return bookedText(key);
    if (focusKey === key) return raw;
    if (raw.trim() === "") return "";
    const q = quantity(raw);
    // A sum that does not add up yet stays as typed rather than resolving to
    // something it does not say.
    return q.ok ? String(q.value) : raw;
  };

  // ── What cannot be typed in at all ──
  //
  // A lock and a fault answer different questions, and conflating them was a
  // bug worth naming. A lock says *no figure could go here*: this vodka had no
  // 60 % bottles when the night began, so no number in that box could ever be
  // true. A fault says *that figure is too big*, three bottles home from a
  // night that took two, which is a thing somebody typed and can retype.
  //
  // The In column used to lock the moment the night's returns caught up with
  // what went out. Which meant typing one too many closed the box you were
  // typing in, along with the rest of the column: the input unmounted under the
  // caret. Overshooting is a fault now, and it says so in words while you keep
  // the caret.
  //
  // Two things are never locked, whatever the arithmetic says. A cell with
  // something already booked on it. Those bottles went out at 60 % and that is
  // exactly why the rung reads empty, so the figure has to stay correctable.
  // And a cell somebody is working in, because a box that vanishes mid-keystroke
  // is never the right answer to anything.
  type Lock = "nothingOnShelf" | "nothingOut";

  function lockOn(product: StockLevelDto, kind: CellKind, level: number): Lock | null {
    const key = cellKey({ productId: product.id, kind, level });
    if ((base.get(key) ?? 0) !== 0) return null;
    if (typed[key] !== undefined || focusKey === key) return null;
    if (kind === "CHECKOUT") {
      return available(product, level) === 0 ? "nothingOnShelf" : null;
    }
    // Nothing can come home, or be dropped, from a night that took nothing out
    // at all. How much of it is still unaccounted for is a different question,
    // and the answer to that one is a fault rather than a locked box.
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

  /**
   * Why a cell cannot hold what somebody typed.
   *
   * `cellFault` is the server's own rule, so a cell is never sent that would be
   * refused, and the reason appears on the row before anybody leaves the box.
   *
   * Keyed by the cell rather than the product, which matters for getting out of
   * a mess: a product whose figures do not add up used to have every one of its
   * cells refused, including the one you were clearing to fix it.
   */
  const faults = new Map<string, string>();
  for (const key of changed) {
    const ref = refOf(key);
    const product = byId.get(ref.productId);
    if (!product) continue;
    // `live`, not `base`: the night's arithmetic is about what the sheet says,
    // and most of a sheet is unsaved for most of an evening. Judged against the
    // log alone, eight beers typed into Ut had not gone out yet, so a spill of
    // one was refused as more than went out, and clearing a row column by
    // column faulted on whichever column was cleared first. The cellar half of
    // the rule still reads `base`, because the shelf has moved for those rows
    // and for no others. See SheetState in lib/stock/cells.ts.
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
   * Write everything that has been typed, in one go.
   *
   * The whole sheet as a single request. The route takes an array of cells and
   * applies them in one transaction (see api/stock/events/[id]/cells/route.ts), so
   * a night either lands or it doesn't, rather than arriving as forty separate
   * decisions.
   *
   * Every cell carries the figure it was decided against. That was cheap when a
   * cell was sent the moment you left it; with a draft that may have been sitting
   * on a phone since before the pub opened it is the whole safety of this
   * screen. If the other phone in the cellar has moved a row since, the server refuses
   * rather than letting one person's evening quietly replace the other's.
   *
   * Cells the rule already refuses are held back, not sent: the row says why,
   * and a request whose answer is known is a round trip spent to be told off.
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
      occurredAt,
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
      // Refused, most often by a cell somebody else has moved. The draft is kept:
      // it is somebody's evening, and the answer to "the figures moved under
      // you" is to show them the new ones and let them decide, not to throw
      // away what they typed. Re-reading is what makes the next attempt carry
      // the right `expected`.
      setBooked({});
      setShifted({});
      router.refresh();
      return;
    }

    // Saved. Everything this page was holding locally is now in the log, so the
    // draft goes and the truth is re-read rather than reconstructed.
    setBooked({});
    setShifted({});
    clearDraft();
    router.refresh();
  }

  /**
   * Throw away everything typed and not saved.
   *
   * Asked first: the draft is the only copy of an evening's work, and this
   * button stands next to the one that keeps it.
   */
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
   * Undo the night.
   *
   * The question changes with what is booked on it, the way the product page's
   * does. A duplicate made a minute ago is a name and nothing else; a pub that
   * ran in March is every crate that went out, and undoing it puts them back on
   * the shelf. A dialog that cried wolf over an empty event would be one people
   * stop reading by the time it matters.
   *
   * The draft goes with it. It lives in localStorage under the event's id, and
   * an event that no longer exists cannot be the thing anybody meant to type
   * those figures into.
   */
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
    // Counted by the transaction rather than by the page: somebody else may
    // have booked on the night between this screen loading and the button.
    notify.success(
      gone.entries > 0
        ? t("event.removedWithLog", { count: gone.entries })
        : t("event.removed"),
    );
    // Not a push. The event is gone, and Back must not lead to its page.
    returnTo("/stock/events");
  }

  /**
   * Take a product off the event: every cell of it back to nothing.
   *
   * Typed into the draft rather than written, like everything else on this
   * sheet now, so a product with rows already booked keeps its line until the
   * next save, showing the zeros that are about to be sent. A product that was
   * only ever added on this screen has nothing to zero and simply goes.
   */
  function drop(productId: string) {
    const product = byId.get(productId);
    if (!product) return;
    setTyped((prev) => {
      const next = { ...prev };
      for (const kind of CELL_KINDS) {
        for (const level of sheetLines(product)) {
          const key = cellKey({ productId, kind, level });
          // "" reads as a zero and books no row at all, which is the same
          // thing this used to send, said in the sheet's own language.
          if ((base.get(key) ?? 0) !== 0) next[key] = "";
          else delete next[key];
        }
      }
      return next;
    });
    setAdded((prev) => prev.filter((id) => id !== productId));
  }



  /**
   * The same row, a different product.
   *
   * Picking the wrong beer off a shelf of forty is the commonest mistake there
   * is on this sheet, and until now the only way back was to remove the row and
   * type the evening's figures again. The counts were never the mistake, so
   * they travel: what was out, what came home and what broke are carried over
   * as they read, typed and saved alike.
   *
   * Saved figures travel by being zeroed on the old product and written on the
   * new one, which the sheet already knows how to say. Both are ordinary cells
   * in the next save, and the route applies them in one transaction. So the log
   * ends up with the movement on the product it happened to, and StockChange
   * records that it moved.
   *
   * Only between products of the same kind. A spirit's rungs have nowhere to go
   * on a can, and silently dropping four of the five figures is not a swap. The
   * picker offers no others.
   */
  function swap(fromId: string, toId: string) {
    const from = byId.get(fromId);
    if (!from || fromId === toId || !byId.has(toId)) return;

    // Read first, write second. What each cell reads comes from `typed` and
    // `base` as this render has them, and reading it inside the updater would
    // be reading one of the two out of the state React is handing back.
    const moves = CELL_KINDS.flatMap((kind) =>
      sheetLines(from).map((level) => ({
        fromKey: cellKey({ productId: fromId, kind, level }),
        toKey: cellKey({ productId: toId, kind, level }),
        // The saved figure, or whatever has been typed over it.
        qty: number(cellKey({ productId: fromId, kind, level })),
      })),
    );

    setTyped((prev) => {
      const next = { ...prev };
      for (const { fromKey, toKey, qty } of moves) {
        // Clear the old one the way `drop` does: "" where a row is booked and
        // has to be told to go, nothing at all where there never was one.
        if ((base.get(fromKey) ?? 0) !== 0) next[fromKey] = "";
        else delete next[fromKey];
        // The target is never already on the sheet, because the picker only
        // offers products that are not, so there is nothing here to overwrite.
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
    // Straight into the first box it can take, so picking a product and saying
    // how many of it is one movement rather than two. For a product new to the
    // event that is Ut, because In and Spill are locked until something has gone
    // out, since nothing can come back from a night that took nothing.
    setSeeking(productId);
  }

  // Scanning a barcode onto the sheet, and inventing a product that isn't
  // there yet. Shared with the delivery sheet, which does the same errand.
  //
  // A scan clears the search as well as adding the row: a sheet narrowed to
  // something else would hide the row the scan just asked for, and the caret
  // would have nowhere to land. A product invented in the dialog does not,
  // because nobody typed a search to get there.
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
  //
  // The same cell vocabulary as the voucher editor (components/voucher-editor
  // .tsx), deliberately: they are the app's two spreadsheets, and a grid you tab
  // through should not feel like a different tool depending on which one you
  // opened. Ruled by `divide-*` on the rows rather than borders on every cell, a
  // fixed layout so content can never widen a column, and a cell that is `p-0`
  // around a bare full-height input. The box *is* the cell, which is what makes
  // the focus ring land on the cell rather than inside it.
  const headerCell = "px-2 py-2.5 text-center font-medium";
  const cellInput =
    "block h-10 w-full bg-transparent px-2 text-center text-sm tabular-nums placeholder:text-muted/50 focus-inset";

  /**
   * The rows a product takes up.
   *
   * A can is one row. A spirit is its name and then its ladder, one row per
   * rung, because bottles are not one quantity: five sealed and one at 40 %
   * are two different things, and a ladder of rows is how a sheet has always
   * said that. What shares a row is the rung, not a pairing; `Hel – Ut 1` and
   * `Hel – In 0` are independent facts that happen to both be about unopened
   * bottles, since a bottle leaves sealed and comes home at whatever it comes
   * home at.
   *
   * All three columns are live on every row, spill included. Dropping a bottle
   * is dropping a bottle, and the rung it came off is the whole of what it
   * cost, because everything left in it goes on the floor.
   */
  const sheetLines = (product: StockLevelDto): number[] =>
    product.kind !== "VOLUME" ? [WHOLE] : [WHOLE, ...LEVELS];

  const rungName = (level: number): string =>
    level === WHOLE ? t("event.level.sealed") : t("event.level.rung", { level });

  // ── Walking the grid ──
  //
  // The shape the keyboard moves over: a row per line of the sheet (a can, or
  // one rung of a spirit's ladder) and a column per direction. Locked cells
  // are holes in it rather than entries, and so are rows a search has hidden,
  // so nothing downstream has to remember to skip them.
  //
  // The moving itself is lib/ui/grid-nav.ts, which knows only the shape. It is
  // not the budget sheet's `use-cell-edit`: that answers select-versus-edit and
  // leaves movement to the browser's own focus order, which works there and
  // does not here, because a row of this table holds a product link and a remove
  // button as well as its figures, and tabbing through those between every pair
  // of numbers is not how anybody fills in a sheet.
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
   * Put the caret in the first box a newly added product can take.
   *
   * Reached both ways in: picked from the row at the bottom, or scanned. Which
   * box that is falls out of the grid rather than being chosen. For a product
   * new to the event it is Ut, because In and Spill are locked until
   * something has gone out; for one already on the sheet it is whichever column
   * the phone is showing.
   *
   * In an effect because the row does not exist until the render after `add`,
   * and a product invented from an unknown barcode does not exist until the
   * server has been round and sent the list again. It clears itself the moment
   * it lands, so nothing keeps stealing focus.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!seeking) return;
    const product = byId.get(seeking);
    if (!product) return;
    outer: for (const level of sheetLines(product)) {
      for (const kind of CELL_KINDS) {
        if (focusCell(cellKey({ productId: seeking, kind, level }))) break outer;
      }
    }
    setSeeking(null);
    // Re-run when the row it wants may have appeared: after the add, and again
    // when the server sends a product that was just created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeking, products, added]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, key: string) =>
    handleKey(e, key, grid, {
      // Three columns wide, and a cell can hold `24*10+30`.
      horizontal: true,
      onEscape: (k) => setTyped((prev) => ({ ...prev, [k]: bookedText(k) })),
    });

  // ── A cell ──
  //
  // A function that returns an input, not a component. A component declared in
  // here would be a new type on every render, and React unmounts and remounts a
  // subtree whose type changed, which took the focus out of the box on the
  // first keystroke, every time.
  function cellFor(product: StockLevelDto, kind: CellKind, level: number) {
    const lock = lockOn(product, kind, level);
    if (lock) {
      return (
        <span
          className="flex h-10 items-center justify-center text-muted/40"
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
          // A cell on its way to the log over a cell that merely holds working:
          // what is about to be written matters more than how it was arrived at.
          changed ? "bg-warning-soft/60 font-medium" : working && "bg-accent-soft/40",
          pending === key && "text-muted",
        )}
        value={display(key)}
        // The sum behind the figure, without having to click into it.
        title={working ? raw : undefined}
        placeholder="0"
        disabled={!canManage}
        // Arriving seeds the cell with what it already says, so editing 120 to
        // 100 is an edit rather than a retype.
        onFocus={(e) => {
          setFocusKey(key);
          setTyped((prev) => (prev[key] === undefined ? { ...prev, [key]: bookedText(key) } : prev));
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => type(key, e.target.value)}
        onBlur={() => setFocusKey((k) => (k === key ? null : k))}
        onKeyDown={(e) => onCellKey(e, key)}
        aria-label={`${product.name} – ${t(`kind.${kind}`)}${
          product.kind === "VOLUME" ? ` – ${rungName(level)}` : ""
        }`}
      />
    );
  }

  return (
    <PageShell
      title={event.name}
      subtitle={event.date}
      back={{ href: "/stock/events", label: t("event.title") }}
      width="wide"
    >
      <Card>
        <SheetHeader
          t={t}
          canManage={canManage}
          occurredAt={occurredAt}
          onOccurredAt={setOccurredAt}
          search={search}
          onSearch={setSearch}
          kinds={CELL_KINDS}
          column={column}
          onColumn={setColumn}
          onRemove={canManage ? remove : undefined}
        />

        {/* No CardBody: the sheet is ruled to the card's own edge, the way the
            voucher editor is. A body would inset it by `px-inset` and the
            outermost column rule would float in a gutter. */}
        {/* The spare rows *are* how a product gets onto the sheet, so an
            event with nothing on it still needs the table. Showing a note
            in its place left a new night with no way in at all. */}
        {rows.length === 0 && !canManage ? (
          <div className="px-inset py-6">
            <EmptyNote>{t("event.nothing")}</EmptyNote>
          </div>
        ) : (
          /* Only ever sideways where there is something to scroll to. On a
             phone the sheet is three columns (product, the one being typed,
             and the total) and that fits: a grid you have to drag about in a
             cellar is a grid nobody finishes. */
          <TableScroll minWidth="min-w-0 md:min-w-[36rem]">
            {/* table-fixed: the header percentages decide the columns, so a
                long product name can never push the number columns about. */}
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="divide-x divide-border border-b border-border bg-surface/40 text-xs text-muted">
                  <th className={cn(headerCell, "w-[34%] text-left")}>{t("event.col.product")}</th>
                  {CELL_KINDS.map((kind) => (
                    <th
                      key={kind}
                      className={cn(headerCell, "w-[15%]", kind !== column && "hidden md:table-cell")}
                    >
                      {t(`kind.${kind}`)}
                    </th>
                  ))}
                  <th className={cn(headerCell, "w-[21%]")}>{t("event.col.sold")}</th>
                </tr>
              </thead>

              {shown.map((productId) => {
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
                    {/* A spirit's own row carries its name and its total; the
                        typing happens on the ladder below it. A can has no
                        ladder, so its one row is both. */}
                    <tr className={cn("divide-x divide-border", isVolume && "bg-surface/40")}>
                      <td className="group px-2 py-1.5 align-middle">
                        <div className="flex items-center justify-between gap-2">
                          {swapping === productId ? (
                            // The row's name, while it is being changed. In
                            // place rather than in a dialog: what is being
                            // answered is "which product is this row", and the
                            // row is where that question is.
                            <div className="flex min-w-0 flex-1 items-center gap-1">
                              <div className="min-w-0 flex-1">
                                <Combobox
                                  autoFocus
                                  size="sm"
                                  value=""
                                  onChange={(toId) => swap(productId, toId)}
                                  // Never one already on the sheet, since two
                                  // rows for one product is what the unique index
                                  // on a cell forbids, and never one counted
                                  // differently: a spirit's rungs have nowhere
                                  // to land on a can.
                                  options={products
                                    .filter(
                                      (p) => !rows.includes(p.id) && p.kind === product.kind,
                                    )
                                    .map((p) => ({ value: p.id, label: p.name }))}
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
                            <span className="min-w-0">
                              <Link
                                href={`/stock/${productId}`}
                                className="font-medium hover:underline"
                              >
                                {product.name}
                              </Link>
                              <span className="ml-2 text-xs text-muted">
                                {isVolume
                                  ? t("holding.volume", {
                                      sealed: shelf.sealed,
                                      open: LEVELS.reduce((n, l) => n + (shelf.open[l] ?? 0), 0),
                                    })
                                  : t("holding.unit", { units: shelf.sealed })}
                              </span>
                              {fault && (
                                <span className="ml-2 text-xs text-danger">
                                  {t(`fault.${fault}`)}
                                </span>
                              )}
                            </span>
                          )}
                          {/* What can be done to the row itself, as opposed to
                              its figures. Two things, so a menu rather than two
                              icons competing for the same corner, and icon
                              only, because forty rows carrying a word each is a
                              column of repeated text where the products should
                              be. */}
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
                              {/* Taking a product off the event entirely. It
                                  removes its rows rather than zeroing them:
                                  picking the wrong beer is not a movement of
                                  nothing, it is no movement, and the log should
                                  say so. */}
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
                          className={cn("p-0 align-middle", kind !== column && "hidden md:table-cell")}
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
                          <td className="py-1.5 pl-6 pr-2 align-middle">
                            <span className="flex items-center gap-1 text-xs text-muted">
                              <IconElbow className="size-3 shrink-0" />
                              {rungName(level)}
                              <span className="text-muted/70">– {available(product, level)}</span>
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

              {/* Said inside the table rather than in place of it: the spare
                  rows below are where you would go next, and hiding them to
                  say "nothing matches" would hide the answer with the
                  question. */}
              {shown.length === 0 && rows.length > 0 && (
                <tbody>
                  <tr>
                    <td colSpan={CELL_KINDS.length + 2} className="px-inset py-4">
                      <EmptyNote>{t("event.sheet.noMatch", { text: search.trim() })}</EmptyNote>
                    </td>
                  </tr>
                </tbody>
              )}

              {/* The next line, the way a sheet always has one. Typing a name
                  into it puts that product on the event, and a name nothing
                  answers to offers to make it.

                  One, not three. Three came from the voucher editor, where you
                  type several lines one after another and a queue of spares
                  saves you making room each time. Here the quick way in is the
                  scanner, so the queue bought nothing and cost three pickers'
                  worth of empty space at the foot of every sheet. */}
              {canManage && (
                <tbody>
                  <tr className="divide-x divide-border">
                    <td className="p-0 align-middle">
                      {/* The two ways of putting a product on the sheet, side
                          by side, because they are one errand. The scanner is
                          the quicker of them and does double duty: a code the
                          event already has jumps to that product's row
                          instead of adding a second one, which is the whole
                          reason it sits on the row that adds rather than off in
                          the header where it read as a separate feature. */}
                      <div className="flex items-center gap-1 pr-1">
                        <div className="min-w-0 flex-1">
                          <Combobox
                            value=""
                            onChange={add}
                            options={products
                              .filter((p) => !rows.includes(p.id))
                              .map((p) => ({ value: p.id, label: p.name }))}
                            onCreate={invent}
                            createLabel={(text) => t("event.sheet.newProduct", { name: text })}
                            placeholder={t("event.sheet.addProduct")}
                            searchPlaceholder={t("event.sheet.addSearch")}
                            aria-label={t("event.sheet.addProduct")}
                            align="left"
                            buttonClassName="h-10 w-full bg-transparent px-2 text-left text-sm text-muted focus-inset"
                          />
                        </div>
                        <IconButton
                          label={t("event.sheet.scan")}
                          title={t("event.sheet.scan")}
                          onClick={scan}
                        >
                          <IconScan className="size-4" />
                        </IconButton>
                      </div>
                    </td>
                    {CELL_KINDS.map((kind) => (
                      <td key={kind} className={cn(kind !== column && "hidden md:table-cell")} />
                    ))}
                    <td />
                  </tr>
                </tbody>
              )}
            </table>
          </TableScroll>
        )}

        {canManage && (
          <SheetSaveBar
            t={t}
            changed={changed}
            faults={faults}
            pending={pending}
            onSave={save}
            onDiscard={discard}
          />
        )}
      </Card>

      {/* The sheet above says where the night's figures ended up. This says how
          they got there, and who. Its own card because they are two questions:
          one is read at a glance, the other only when something looks wrong. */}
      <Card>
        <CardHeader title={t("changes.title")} />
        <ChangeFeed changes={changes} scope="event" />
      </Card>

      <Link href={`/stock/log?event=${event.id}`} className="text-sm font-medium text-accent">
        {t("event.movements", { count: event.entries })}
      </Link>

      {overlay}
    </PageShell>
  );
}
