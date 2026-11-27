"use client";

// Reordering table rows by hand with a pointer drag, shared by the kontering (components/voucher-editor.tsx) and the
// budget sheet (budget/[budgetId]/cost-center-sheet.tsx). Not HTML5 drag, which only snaps and has no touch: the
// lifted row glides under the pointer and the others snap into its gap.
//
// The hook owns the pointer: the press, the threshold before lifting, following the pointer on the window, Escape,
// scrolling at the edge, and keeping the lifted row under the pointer. The caller owns the order: `over` is told what
// is under the pointer and moves the row in its own state, and `drop` or `cancel` ends it.
//
// The table must keep separate borders (gridTable in lib/ui/grid-table.ts), or the lifted row leaves its column rules
// behind.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { autoScrollStep, verticalScroller } from "@/lib/ui/auto-scroll";

/** How far the pointer moves before the row lifts. A press that moves less is a click. */
export const DRAG_THRESHOLD_PX = 4;

export interface RowDragPointer {
  x: number;
  y: number;
}

export interface RowDragOptions<S> {
  /** The drag's own state, made when the row lifts (the order it found, for Escape). Kept in a ref, so `over` may change it. */
  begin: (id: string) => S;
  /**
   * The pointer moved, or the view scrolled under it. `under` is the element at the pointer, the lifted row aside (it
   * is `pointer-events-none`). Move the row here, in the caller's state.
   */
  over: (state: S, under: HTMLElement | null, pointer: RowDragPointer) => void;
  /** Let go: keep the order. */
  drop: (state: S) => void;
  /** Escape or a cancelled pointer: put the order back. */
  cancel: (state: S) => void;
  /** Where the lifted row may go, in viewport pixels. Without it, anywhere. */
  bounds?: () => { top: number; bottom: number } | null;
}

export interface RowDrag {
  /** The row being carried, or null. */
  draggingId: string | null;
  /** On the grip's pointerdown. `onClick`: what a press that never lifted the row does instead. */
  start: (e: React.PointerEvent, id: string, onClick?: () => void) => void;
  /**
   * The ref for each row: `ref={drag.rowRef(id)}`. A row carried into another group may be a new <tr>, so the lifted
   * element is taken from the rows as they mount, not kept from the press.
   */
  rowRef: (id: string) => (el: HTMLTableRowElement | null) => void;
}

interface Live<S> {
  id: string;
  state: S;
  pointer: RowDragPointer;
  /** Where in the row the pointer took hold. */
  grab: number;
  /** What scrolls when the row is carried to the edge, resolved at the press. */
  scroller: HTMLElement | null;
}

export function useRowDrag<S>(options: RowDragOptions<S>): RowDrag {
  // The options are read when an event comes, not captured when the drag began.
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  const live = useRef<Live<S> | null>(null);
  const lifted = useRef<HTMLTableRowElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  /** Keep the lifted row under the pointer. Written to the node: a state update per pixel would render the table. */
  const lift = useCallback(() => {
    const el = lifted.current;
    const d = live.current;
    if (!el || !d) return;
    el.style.transform = "";
    const box = el.getBoundingClientRect();
    let y = d.pointer.y - d.grab - box.top;
    const room = opts.current.bounds?.();
    if (room) y = Math.min(Math.max(y, room.top - box.top), room.bottom - box.height - box.top);
    el.style.transform = `translateY(${y}px)`;
  }, []);

  // After every render while carrying: the rows have moved, so the lifted one is put back under the pointer before paint.
  useLayoutEffect(() => {
    if (draggingId) lift();
  });

  const start = useCallback((e: React.PointerEvent, id: string, onClick?: () => void) => {
    if (e.button !== 0) return;
    const tr = (e.target as HTMLElement).closest("tr");
    if (!tr) return;
    // Stops text selection while dragging.
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const grab = startY - tr.getBoundingClientRect().top;
    const scroller = verticalScroller(tr);
    // Lifted only once the pointer has moved, so a click does not flash the lifted row on and off.
    let up = false;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
      up = true;
      done();
      lifted.current = tr;
      live.current = {
        id,
        state: opts.current.begin(id),
        pointer: { x: ev.clientX, y: ev.clientY },
        grab,
        scroller,
      };
      setDraggingId(id);
    };
    const release = () => {
      done();
      if (!up) onClick?.();
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", done);
  }, []);

  // Followed on the window: the pointer leaves the grip at once.
  useEffect(() => {
    if (!draggingId) return;
    const end = (how: "drop" | "cancel") => {
      const d = live.current;
      if (lifted.current) lifted.current.style.transform = "";
      lifted.current = null;
      live.current = null;
      setDraggingId(null);
      if (d) opts.current[how](d.state);
    };
    /** Shared with the frame loop: scrolling brings new rows under a pointer that has not moved. */
    const resolve = (d: Live<S>) => {
      const under = document.elementFromPoint(d.pointer.x, d.pointer.y) as HTMLElement | null;
      opts.current.over(d.state, under, d.pointer);
      lift();
    };
    const move = (e: PointerEvent) => {
      const d = live.current;
      if (!d) return;
      d.pointer = { x: e.clientX, y: e.clientY };
      resolve(d);
    };
    // Carrying a row to the edge scrolls the view. A frame loop, since a pointer held still sends no events.
    let frame = 0;
    const tick = () => {
      const d = live.current;
      if (d && autoScrollStep(d.scroller, d.pointer.y)) resolve(d);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const drop = () => end("drop");
    const cancel = () => end("cancel");
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [draggingId, lift]);

  const rowRef = useCallback(
    (id: string) => (el: HTMLTableRowElement | null) => {
      // Only set, never cleared here: a row carried into another group mounts as the old one goes.
      if (el && live.current?.id === id) lifted.current = el;
    },
    [],
  );

  return { draggingId, start, rowRef };
}

/** Where a row dropped over `over` lands among `ids`: before it, or after it when the pointer is in its lower half. */
export function placeAmong(
  ids: readonly string[],
  id: string,
  overId: string | null,
  after: boolean,
): string[] {
  const list = ids.filter((x) => x !== id);
  const at = overId ? list.indexOf(overId) : -1;
  list.splice(at === -1 ? list.length : at + (after ? 1 : 0), 0, id);
  return list;
}

/** Whether the pointer is in the lower half of `el`. */
export const belowMiddle = (el: Element, y: number): boolean => {
  const box = el.getBoundingClientRect();
  return y > box.top + box.height / 2;
};
