// The budget cell-editing layer: input renderers, buffered-edit and focus state, and the
// optimistic commit (apply locally, re-evaluate on the client, PATCH in the background).
import { useState } from "react";
import { usePhone } from "@/lib/ui/media";
import { toStored, toDisplay, type BudgetGrid } from "@/lib/budget/grid";
import { cn } from "@/lib/ui/utils";
import { recomputeBudget } from "./recompute";
import {
  editFormula,
  fmt,
  fmtScalar,
  formulaIdleText,
  prettyFormula,
  normalizeFormula,
} from "./budget-helpers";
import type {
  Budget,
  ApiFn,
  MutateFn,
  CellArgs,
  FormulaArgs,
  CellFn,
  FormulaFn,
} from "./budget-types";
import type { UndoStep } from "./use-undo";

interface Opts {
  grid: BudgetGrid;
  isAdmin: boolean;
  budget: Budget;
  setBudget: React.Dispatch<React.SetStateAction<Budget>>;
  /** The page's `useMutation().mutate`, passed in so a cell edit shares its busy scope. */
  mutate: MutateFn;
  load: () => Promise<void>;
  api: ApiFn;
  /** Marks an own write for the page's live poll, so its answer cannot undo this edit. */
  tracked: <T>(write: () => Promise<T>) => Promise<T>;
  /** Puts an edit on the page's ⌘Z history (use-undo.ts). */
  record: (step: UndoStep) => void;
}

export function useBudgetCells({
  grid,
  isAdmin,
  budget,
  setBudget,
  mutate,
  load,
  api,
  tracked,
  record,
}: Opts) {
  // On a phone a Belopp cell is ~110px: show the answer and keep the working for the tap, since
  // the equation would push out the number being scanned for (see cost-center-sheet.tsx).
  const compact = usePhone();

  // Buffered in-progress cell edits, keyed `${id}:${field}`.
  const [pending, setPending] = useState<Record<string, string>>({});
  // Which formula cell is currently focused (it shows its formula once edited, see `showing`).
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // The formula cell the formula bar is showing, with what saving it needs. Kept while focus
  // moves from the cell to the bar, so the bar edits the same buffered text.
  const [active, setActive] = useState<ActiveCell | null>(null);

  const pVal = (id: string, field: string, actual: string) => pending[`${id}:${field}`] ?? actual;
  const setP = (id: string, field: string, v: string) =>
    setPending((p) => ({ ...p, [`${id}:${field}`]: v }));
  const clearP = (id: string, field: string) =>
    setPending((p) => {
      const n = { ...p };
      delete n[`${id}:${field}`];
      return n;
    });

  // A cell edit applies locally and re-runs the evaluator on the client (`recomputeBudget`)
  // rather than refetching, and PATCHes in the background, reloading only on failure.

  function mergeValues(
    cur: Record<string, string>,
    patch: Record<string, string>,
  ): Record<string, string> {
    const merged = { ...cur };
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v !== "string") continue;
      if (v.trim() === "") delete merged[k];
      else merged[k] = v.trim();
    }
    return merged;
  }

  function applyLocal(rev: Budget, url: string, payload: Record<string, unknown>): Budget | null {
    const str = (k: string, fallback: string) =>
      typeof payload[k] === "string" ? payload[k] : fallback;
    let m: RegExpMatchArray | null;
    if ((m = url.match(/\/line-items\/([^/]+)$/))) {
      const id = m[1];
      return {
        ...rev,
        costCenters: rev.costCenters.map((cc) => ({
          ...cc,
          accounts: cc.accounts.map((a) => ({
            ...a,
            lineItems: a.lineItems.map((li) =>
              li.id !== id
                ? li
                : {
                    ...li,
                    description: str("description", li.description),
                    expression: str("expression", li.expression),
                    values:
                      payload.columnValues && typeof payload.columnValues === "object"
                        ? mergeValues(li.values, payload.columnValues as Record<string, string>)
                        : li.values,
                  },
            ),
          })),
        })),
      };
    }
    if ((m = url.match(/\/accounts\/([^/]+)$/))) {
      const id = m[1];
      return {
        ...rev,
        costCenters: rev.costCenters.map((cc) => ({
          ...cc,
          accounts: cc.accounts.map((a) =>
            a.id !== id
              ? a
              : {
                  ...a,
                  accountCode: str("accountCode", a.accountCode),
                  accountName: str("accountName", a.accountName),
                },
          ),
        })),
      };
    }
    if ((m = url.match(/\/variables\/([^/]+)$/))) {
      const id = m[1];
      return {
        ...rev,
        variables: rev.variables.map((v) =>
          v.id !== id
            ? v
            : {
                ...v,
                name: str("name", v.name),
                expression: str("expression", v.expression),
              },
        ),
      };
    }
    return null;
  }

  // The optimistic path: show the edit, then tell the server through the shared `mutate`,
  // without a refresh (the value is already on screen; see components/shell/use-mutation.ts).
  async function commitField(url: string, payload: Record<string, unknown>) {
    const next = applyLocal(budget, url, payload);
    if (!next) return void api(url, "PATCH", payload); // unknown shape → reload path
    await tracked(async () => {
      setBudget(recomputeBudget(next));
      const ok = await mutate(url, { method: "PATCH", body: payload, refresh: false });
      if (!ok) await load(); // rejected: the screen is ahead of the server, resync
    });
  }

  /** An edit of the cell `id:field` from `before` to `after`: saved, and put on the ⌘Z history. */
  async function save(
    id: string,
    field: string,
    url: string,
    payload: (v: string) => Record<string, unknown>,
    before: string,
    after: string,
  ) {
    record({
      kind: "field",
      url,
      before: payload(before),
      after: payload(after),
      cell: `${id}:${field}`,
    });
    await commitField(url, payload(after));
  }

  async function commit(
    id: string,
    field: string,
    actual: string,
    url: string,
    payload: (v: string) => Record<string, unknown>,
  ) {
    const key = `${id}:${field}`;
    const v = pending[key];
    if (v === undefined || v.trim() === actual.trim()) {
      clearP(id, field);
      return;
    }
    clearP(id, field);
    await save(id, field, url, payload, actual, v.trim());
  }

  async function commitFormula(
    id: string,
    field: string,
    raw: string,
    sheet: string,
    url: string,
    payload: (v: string) => Record<string, unknown>,
  ) {
    const key = `${id}:${field}`;
    setFocusKey((k) => (k === key ? null : k));
    setActive((a) => (a?.key === key ? null : a));
    const typed = pending[key];
    if (typed === undefined) return;
    // Forgiving entry ("2x3x12", "8 × TACK_POLICY") becomes a formula before row references are bound.
    const stored = toStored(normalizeFormula(typed), sheet, grid);
    clearP(id, field);
    if (stored.trim() === raw.trim()) return;
    await save(id, field, url, payload, raw, stored);
  }

  /**
   * ⌘V on a selected cell: the clipboard's text, replacing the cell and saved where it stands,
   * as in a spreadsheet. Null leaves the paste to the browser: a cell being edited takes it at
   * the caret. Saved without leaving the cell, which would flash its idle look in between.
   * The first line only, since a cell holds one.
   */
  function pastedText(e: React.ClipboardEvent<HTMLInputElement>, gated?: boolean): string | null {
    if (!gated || e.currentTarget.closest(".is-editing")) return null;
    e.preventDefault();
    return e.clipboardData.getData("text/plain").split(/\r?\n/)[0].trim();
  }

  // Enter finishes the edit (blur commits it), Escape restores. Escape keeps focus, so
  // `focusKey` stays set: clearing it made the next Enter commit the idle display string.
  const editKeys = (id: string, field: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") clearP(id, field);
  };

  // Invoked as a plain function (not <Cell/>) so the <input> keeps focus across re-renders.
  const renderCell: CellFn = ({
    id,
    field,
    actual,
    className,
    placeholder,
    mono,
    url,
    payload,
    gated,
  }: CellArgs) => {
    if (!isAdmin) {
      return (
        <div className={cn("px-2 py-1 min-h-7", mono && "font-mono text-xs", className)}>
          {actual || <span className="text-muted">{placeholder}</span>}
        </div>
      );
    }
    return (
      <input
        data-cell={gated ? `${id}:${field}` : undefined}
        value={pVal(id, field, actual)}
        onChange={(e) => setP(id, field, e.target.value)}
        onBlur={() => commit(id, field, actual, url, payload)}
        onPaste={(e) => {
          const text = pastedText(e, gated);
          if (text === null) return;
          clearP(id, field);
          if (text !== actual.trim()) void save(id, field, url, payload, actual, text);
        }}
        onKeyDown={editKeys(id, field)}
        placeholder={placeholder}
        className={cn(
          "w-full bg-transparent px-2 py-1 outline-none",
          mono && "font-mono text-xs",
          className,
        )}
      />
    );
  };

  // Shows the evaluated value when idle, the formula (row references as #5, leading "=") while focused.
  const renderFormula: FormulaFn = ({
    id,
    field,
    raw,
    computed,
    sheet,
    bad,
    placeholder,
    url,
    payload,
    className,
    display = "value",
    gated,
    unit = "ore",
    editing,
  }: FormulaArgs) => {
    const key = `${id}:${field}`;
    // A Belopp is öre, a variable is whatever it means: the shared renderer needs to be told.
    const show = unit === "scalar" ? fmtScalar : fmt;
    const focused = focusKey === key;
    // The formula is shown while it is being written: in edit mode, or typed (here or in the
    // formula bar). Only selected, the cell reads as its value, as a spreadsheet's does.
    const showing = focused && (editing === undefined || editing || pending[key] !== undefined);
    // An empty amount is a zero (lib/budget/eval.ts) and reads as one, not as a faint hint. Only
    // a formula column (Variabler) keeps an empty cell empty.
    const empty = raw.trim() === "" && display === "formula";
    const isFormula = raw.trim().startsWith("=");
    const formulaText = toDisplay(raw, sheet, grid);

    const pretty = isFormula ? prettyFormula(formulaText) : formulaText;
    // Being edited, the formula reads as it is typed (editFormula), not spaced out.
    const editText = isFormula ? editFormula(formulaText) : formulaText;
    const asFormula = display === "formula" || showing;
    const idle = formulaIdleText({
      raw: raw.trim() === "" && display === "value" ? "0" : raw,
      pretty,
      value: show(computed ?? 0),
      placeholder,
      asFormula: display === "formula",
      bad,
      compact,
    });
    // On a wide screen an idle formula reads as its working, muted, then its answer, so the
    // column still reads as a column of figures ("30 × 375" then "11 250").
    const split = !showing && display === "value" && isFormula && !bad && !compact && !empty;
    const working = split && (
      <>
        <span className="min-w-0 truncate text-muted">{pretty}</span>
        <span className="ml-2 shrink-0">{show(computed)}</span>
      </>
    );
    if (!isAdmin) {
      return (
        <div
          className={cn(
            "px-2 py-1 min-h-7",
            display === "formula" ? "font-mono text-xs" : "text-right tabular-nums",
            split && "flex items-center justify-end",
            empty && "text-muted",
            bad && !empty && "text-danger",
            className,
          )}
          title={isFormula ? formulaText : undefined}
        >
          {working || idle}
        </div>
      );
    }
    return (
      <div className="relative">
        <input
          data-cell={gated ? key : undefined}
          value={showing ? (pending[key] ?? editText) : empty ? "" : idle}
          placeholder={placeholder}
          title={isFormula && !showing ? formulaText : undefined}
          // Focusing swaps the display to the formula, so the caret is placed after that
          // re-render. A gated cell is only selected on focus: leave a collapsed caret.
          data-formula-key={key}
          onFocus={(e) => {
            setFocusKey(key);
            setActive({ key, id, field, raw, sheet, url, payload, editText });
            // Where selecting shows the value, nothing is buffered until an edit: a buffer of
            // the formula made on focus was saved back on leaving, over a value written since
            // (a block paste).
            if (editing === undefined && pending[key] === undefined) setP(id, field, editText);
            const el = e.currentTarget;
            requestAnimationFrame(() => {
              if (gated) el.setSelectionRange(el.value.length, el.value.length);
              else el.select();
            });
          }}
          onChange={(e) => setP(id, field, e.target.value)}
          onBlur={(e) => {
            // Into the formula bar the edit goes on there, so it is not saved yet.
            if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.dataset.formulaBar)
              return;
            void commitFormula(id, field, raw, sheet, url, payload);
          }}
          onPaste={(e) => {
            const text = pastedText(e, gated);
            if (text === null) return;
            const stored = toStored(normalizeFormula(text), sheet, grid);
            // The cell keeps focus, so it goes on showing the formula, now the pasted one.
            clearP(id, field);
            if (stored.trim() !== raw.trim()) void save(id, field, url, payload, raw, stored);
          }}
          onKeyDown={editKeys(id, field)}
          className={cn(
            "w-full bg-transparent px-2 py-1 outline-none placeholder:text-muted",
            asFormula ? "font-mono text-xs" : "text-right tabular-nums",
            !asFormula && isFormula && "bg-accent-soft/30",
            bad && !empty && "text-danger",
            // The overlay below draws the text; the input keeps it for copying and screen readers.
            split && "text-transparent",
            className,
          )}
        />
        {split && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-end px-2 tabular-nums"
          >
            {working}
          </div>
        )}
      </div>
    );
  };

  /**
   * The spreadsheet's formula bar: the selected Belopp cell's whole formula, editable at full
   * width. With no cell selected it lists what a formula can refer to.
   */
  const renderFormulaBar = (labels: { formula: string; hint: string }) => {
    if (!isAdmin) return null;
    const key = active?.key;
    const row = active ? grid.lineLoc.get(active.id)?.row : undefined;
    return (
      // Borderless: it is the foot of the totals card (cost-center-sheet.tsx).
      <div className="flex items-center text-sm">
        <span className="w-14 shrink-0 border-r border-border px-2 py-1.5 text-center font-mono text-xs text-muted">
          {row !== undefined ? `#${row}` : "fx"}
        </span>
        <input
          data-formula-bar="true"
          aria-label={labels.formula}
          readOnly={!active}
          value={active && key ? (pending[key] ?? active.editText) : ""}
          placeholder={labels.hint}
          onChange={(e) => active && setP(active.id, active.field, e.target.value)}
          onKeyDown={(e) => {
            if (!active) return;
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              clearP(active.id, active.field);
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            if (!active) return;
            // Back into its own cell the edit carries on there.
            const to = e.relatedTarget;
            if (to instanceof HTMLElement && to.dataset.formulaKey === active.key) return;
            const { id, field, raw, sheet, url, payload } = active;
            void commitFormula(id, field, raw, sheet, url, payload);
          }}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted"
        />
      </div>
    );
  };

  /**
   * Let go of what the cell `id:field` holds for an edit, after it was written from outside
   * (a block paste), so neither the cell nor the formula bar puts the old text back.
   */
  const forgetCell = (id: string, field: string) => {
    clearP(id, field);
    setActive((a) => (a?.key === `${id}:${field}` ? null : a));
  };

  return { renderCell, renderFormula, renderFormulaBar, commitField, forgetCell };
}

interface ActiveCell {
  key: string;
  id: string;
  field: string;
  raw: string;
  sheet: string;
  url: string;
  payload: (v: string) => Record<string, unknown>;
  /** The formula as it reads when the cell was selected, for after an Escape. */
  editText: string;
}
