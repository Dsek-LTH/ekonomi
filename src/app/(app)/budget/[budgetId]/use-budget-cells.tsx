// The budget cell-editing layer: input renderers, buffered-edit and focus state, and the
// optimistic commit (apply locally, re-evaluate on the client, PATCH in the background).
import { useState } from "react";
import { usePhone } from "@/lib/ui/media";
import { toStored, toDisplay, type BudgetGrid } from "@/lib/budget/grid";
import { cn } from "@/lib/ui/utils";
import { recomputeBudget } from "./recompute";
import { fmt, fmtScalar, formulaIdleText, prettyFormula, normalizeFormula } from "./budget-helpers";
import type {
  Budget,
  ApiFn,
  MutateFn,
  CellArgs,
  FormulaArgs,
  CellFn,
  FormulaFn,
} from "./budget-types";

interface Opts {
  grid: BudgetGrid;
  isAdmin: boolean;
  budget: Budget;
  setBudget: React.Dispatch<React.SetStateAction<Budget>>;
  /** The page's `useMutation().mutate`, passed in so a cell edit shares its busy scope. */
  mutate: MutateFn;
  load: () => Promise<void>;
  api: ApiFn;
}

export function useBudgetCells({ grid, isAdmin, budget, setBudget, mutate, load, api }: Opts) {
  // On a phone a Belopp cell is ~110px: show the answer and keep the working for the tap, since
  // the equation would push out the number being scanned for (see cost-center-sheet.tsx).
  const compact = usePhone();

  // Buffered in-progress cell edits, keyed `${id}:${field}`.
  const [pending, setPending] = useState<Record<string, string>>({});
  // Which formula cell is currently focused (shows the formula instead of the value).
  const [focusKey, setFocusKey] = useState<string | null>(null);

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
    setBudget(recomputeBudget(next));
    const ok = await mutate(url, { method: "PATCH", body: payload, refresh: false });
    if (!ok) await load(); // rejected: the screen is ahead of the server, resync
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
    await commitField(url, payload(v.trim()));
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
    const typed = pending[key];
    if (typed === undefined) return;
    // Forgiving entry ("2x3x12", "8 × TACK_POLICY") becomes a formula before A1 references are bound.
    const stored = toStored(normalizeFormula(typed), sheet, grid);
    clearP(id, field);
    if (stored.trim() === raw.trim()) return;
    await commitField(url, payload(stored));
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
        <div className={cn("px-2 py-1.5 min-h-8", mono && "font-mono text-xs", className)}>
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
        onKeyDown={editKeys(id, field)}
        placeholder={placeholder}
        className={cn(
          "w-full bg-transparent px-2 py-1.5 outline-none",
          mono && "font-mono text-xs",
          className,
        )}
      />
    );
  };

  // Shows the evaluated value when idle, the formula (A1 form, leading "=") while focused.
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
  }: FormulaArgs) => {
    const key = `${id}:${field}`;
    // A Belopp is öre, a variable is whatever it means: the shared renderer needs to be told.
    const show = unit === "scalar" ? fmtScalar : fmt;
    const focused = focusKey === key;
    const empty = raw.trim() === "";
    const isFormula = raw.trim().startsWith("=");
    const formulaText = toDisplay(raw, sheet, grid);

    const pretty = isFormula ? prettyFormula(formulaText) : formulaText;
    const asFormula = display === "formula" || focused;
    const idle = formulaIdleText({
      raw,
      pretty,
      value: show(computed),
      placeholder,
      asFormula: display === "formula",
      bad,
      compact,
    });
    if (!isAdmin) {
      return (
        <div
          className={cn(
            "px-2 py-1.5 min-h-8",
            display === "formula" ? "font-mono text-xs" : "text-right tabular-nums",
            empty && "text-muted",
            bad && !empty && "text-danger",
            className,
          )}
          title={isFormula ? formulaText : undefined}
        >
          {idle}
        </div>
      );
    }
    return (
      <input
        data-cell={gated ? key : undefined}
        value={focused ? (pending[key] ?? pretty) : empty ? "" : idle}
        placeholder={placeholder}
        title={isFormula && !focused ? formulaText : undefined}
        // Focusing swaps the display to the formula, so the caret is placed after that
        // re-render. A gated cell is only selected on focus: leave a collapsed caret.
        onFocus={(e) => {
          setFocusKey(key);
          if (pending[key] === undefined) setP(id, field, pretty);
          const el = e.currentTarget;
          requestAnimationFrame(() => {
            if (gated) el.setSelectionRange(el.value.length, el.value.length);
            else el.select();
          });
        }}
        onChange={(e) => setP(id, field, e.target.value)}
        onBlur={() => commitFormula(id, field, raw, sheet, url, payload)}
        onKeyDown={editKeys(id, field)}
        className={cn(
          "w-full bg-transparent px-2 py-1.5 outline-none placeholder:text-muted",
          asFormula ? "font-mono text-xs" : "text-right tabular-nums",
          !asFormula && isFormula && "bg-accent-soft/30",
          bad && !empty && "text-danger",
          className,
        )}
      />
    );
  };

  return { renderCell, renderFormula };
}
