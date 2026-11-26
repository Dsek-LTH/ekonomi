"use client";

// ⌘Z and ⌘⇧Z on a budget page: your own edits, newest first, for as long as the page is open.
// What is undone is what you did, not what somebody else did since (as in a shared
// spreadsheet). A cell edit is undone by writing its old value back; a line made is undone by
// deleting it and a line deleted by making it again where it stood. A line made again has a
// new id, so the steps still naming the old one are pointed at the new one. A formula that
// referenced a deleted line does not get it back: the reference was to the old id.
//
// While a cell is being edited, or focus is in a text field that is not a sheet cell (or in a
// blank row with something written in it), the keys are the browser's own text undo.
import { useCallback, useEffect, useRef } from "react";

type Payload = Record<string, unknown>;

export interface LineBody {
  description: string;
  expression: string;
}

export type UndoStep =
  | {
      kind: "field";
      url: string;
      before: Payload;
      after: Payload;
      /** The cell's `data-cell` key, focused when the step is undone or redone. */
      cell?: string;
    }
  | {
      /** Several steps as one (a block paste that also made lines): undone and redone together. */
      kind: "group";
      steps: UndoStep[];
    }
  | {
      /** Many cells written as one edit (a block paste): undone and redone together. */
      kind: "fields";
      steps: { url: string; before: Payload; after: Payload }[];
    }
  | {
      /**
       * Several lines made or deleted as one (a paste that made lines, Ta bort on several):
       * deleted or made again in one request each way.
       */
      kind: "lines";
      /** True for lines made, false for lines deleted. */
      created: boolean;
      lines: { accountId: string; lineId: string; body: LineBody }[];
      /** Each account's line ids, in order, as they were with these lines in place. */
      orders: { accountId: string; ids: string[] }[];
    }
  | {
      kind: "line";
      /** True for a line made, false for one deleted. */
      created: boolean;
      accountId: string;
      lineId: string;
      body: LineBody;
      /** The account's line ids, in order, as they were with this line in place. */
      order: string[];
    };

export interface UndoHandlers {
  /** Write a cell's value the way an edit does, without recording it. */
  applyField: (url: string, payload: Payload) => Promise<void>;
  /** Write many cells in one request, without recording it. Each entry is a line's url and fields. */
  applyFields: (writes: { url: string; payload: Payload }[]) => Promise<void>;
  /** Make a line in `accountId`; the new line's id, or null if refused. */
  createLine: (accountId: string, body: LineBody) => Promise<string | null>;
  deleteLine: (lineId: string) => Promise<boolean>;
  /** Order the account's lines; `made` is a line just made, kept even if not yet on screen. */
  reorder: (accountId: string, ids: string[], made: string) => Promise<boolean>;
  /** Delete many lines in one request. */
  deleteLines: (lineIds: string[]) => Promise<boolean>;
  /** Make many lines again in one request, each account put back in order. Old id to new, or null. */
  restoreLines: (
    lines: { accountId: string; lineId: string; body: LineBody }[],
    orders: { accountId: string; ids: string[] }[],
  ) => Promise<Record<string, string> | null>;
}

const LIMIT = 100;

/** A line made again has a new id: the steps still naming the old one, made to name the new one. */
export function repointSteps(steps: UndoStep[], from: string, to: string): UndoStep[] {
  const url = (u: string) =>
    u.endsWith(`/budget-line-items/${from}`) ? u.slice(0, -from.length) + to : u;
  const id = (x: string) => (x === from ? to : x);
  return steps.map((s) =>
    s.kind === "group"
      ? { ...s, steps: repointSteps(s.steps, from, to) }
      : s.kind === "lines"
        ? {
            ...s,
            lines: s.lines.map((l) => ({ ...l, lineId: id(l.lineId) })),
            orders: s.orders.map((o) => ({ ...o, ids: o.ids.map(id) })),
          }
        : s.kind === "fields"
          ? { ...s, steps: s.steps.map((f) => ({ ...f, url: url(f.url) })) }
          : s.kind === "line"
            ? {
                ...s,
                lineId: s.lineId === from ? to : s.lineId,
                order: s.order.map((id) => (id === from ? to : id)),
              }
            : {
                ...s,
                // A line's url ends with its id (`/api/budget-line-items/<id>`): matched whole.
                url: s.url.endsWith(`/budget-line-items/${from}`)
                  ? s.url.slice(0, -from.length) + to
                  : s.url,
                cell: s.cell?.startsWith(`${from}:`) ? to + s.cell.slice(from.length) : s.cell,
              },
  );
}

export function useUndo(handlers: UndoHandlers) {
  const past = useRef<UndoStep[]>([]);
  const future = useRef<UndoStep[]>([]);
  const busy = useRef(false);
  const live = useRef(handlers);
  useEffect(() => {
    live.current = handlers;
  });

  const record = useCallback((step: UndoStep) => {
    past.current.push(step);
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
  }, []);

  function repoint(from: string, to: string) {
    past.current = repointSteps(past.current, from, to);
    future.current = repointSteps(future.current, from, to);
  }

  /**
   * Make the step's line again where it stood. False if the server refused. The step itself is
   * off the stacks while it runs, so it is repointed here and `repoint` does the rest.
   */
  async function remake(step: Extract<UndoStep, { kind: "line" }>): Promise<boolean> {
    const h = live.current;
    const id = await h.createLine(step.accountId, step.body);
    if (!id) return false;
    const old = step.lineId;
    step.lineId = id;
    step.order = step.order.map((x) => (x === old ? id : x));
    repoint(old, id);
    await h.reorder(step.accountId, step.order, id);
    return true;
  }

  /** Apply `step` forwards (redo) or backwards (undo). */
  async function apply(step: UndoStep, back: boolean): Promise<boolean> {
    const h = live.current;
    if (step.kind === "lines") {
      // Undoing lines made deletes them, as does redoing lines deleted; the other two remake them.
      if (step.created === back) return h.deleteLines(step.lines.map((l) => l.lineId));
      const made = await h.restoreLines(step.lines, step.orders);
      if (!made) return false;
      // The lines have new ids: this step and every other naming the old ones follow them.
      for (const [old, now] of Object.entries(made)) {
        step.lines = step.lines.map((l) => (l.lineId === old ? { ...l, lineId: now } : l));
        step.orders = step.orders.map((o) => ({
          ...o,
          ids: o.ids.map((x) => (x === old ? now : x)),
        }));
        repoint(old, now);
      }
      return true;
    }
    if (step.kind === "group") {
      // Backwards in reverse: the lines made are deleted before the cells are written back.
      const order = back ? [...step.steps].reverse() : [...step.steps];
      for (let i = 0; i < order.length; i++) {
        const sub = order[i];
        const was =
          sub.kind === "line"
            ? [sub.lineId]
            : sub.kind === "lines"
              ? sub.lines.map((l) => l.lineId)
              : [];
        if (!(await apply(sub, back))) return false;
        const now =
          sub.kind === "line"
            ? [sub.lineId]
            : sub.kind === "lines"
              ? sub.lines.map((l) => l.lineId)
              : [];
        // A line made again has a new id. The steps after it in this group (off the stacks while
        // the group runs, so `repoint` does not reach them) are pointed at it here, or a later
        // one would name the old id and miss the line just made.
        was.forEach((old, k) => {
          if (now[k] === old) return;
          const rest = repointSteps(order.slice(i + 1), old, now[k]);
          order.splice(i + 1, rest.length, ...rest);
        });
      }
      // Kept in the group's own order, with any new ids, for the next undo or redo.
      step.steps = back ? order.reverse() : order;
      return true;
    }
    if (step.kind === "fields") {
      await h.applyFields(
        step.steps.map((f) => ({ url: f.url, payload: back ? f.before : f.after })),
      );
      return true;
    }
    if (step.kind === "field") {
      await h.applyField(step.url, back ? step.before : step.after);
      if (step.cell) {
        const el = document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(step.cell)}"]`);
        el?.focus();
      }
      return true;
    }
    // Undoing a made line deletes it, as does redoing a deleted one; the other two remake it.
    const remove = step.created === back;
    return remove ? h.deleteLine(step.lineId) : remake(step);
  }

  const step = useCallback(async (back: boolean) => {
    if (busy.current) return;
    const from = back ? past : future;
    const to = back ? future : past;
    const next = from.current.pop();
    if (!next) return;
    busy.current = true;
    try {
      const ok = await apply(next, back);
      (ok ? to : from).current.push(next);
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="dialog"]')) return;
      const field =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      // Text being typed keeps the browser's own undo: a cell in edit mode, or any field that
      // is not a sheet cell (a comment, the search box). The blank row only while something is
      // written in it: entering a line leaves the caret there, empty, and ⌘Z then undoes it.
      if (field && target.dataset.blankCell !== undefined) {
        const row = target.closest("tr");
        const typed = [...(row?.querySelectorAll("input") ?? [])].some((i) => i.value !== "");
        if (typed) return;
      } else if (field && (target.dataset.cell === undefined || target.closest(".is-editing"))) {
        return;
      }
      e.preventDefault();
      void step(!e.shiftKey);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [step]);

  return { record };
}
