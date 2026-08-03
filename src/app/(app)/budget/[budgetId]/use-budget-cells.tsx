// The budget cell-editing layer: the read-only-until-edit input renderers
// (text / formula / auto), the buffered-edit + focus state, and the optimistic
// commit path (apply locally, re-evaluate on the client, PATCH in the
// background). Returned to the budget client and threaded into the sheets.
// (Edit mode itself belongs to the sheet that owns the keyboard nav.)
import { useState } from "react";
import { toStored, toDisplay, EXTRA_COLUMN_KEYS, type BudgetGrid } from "@/lib/budget/grid";
import { sheetKey } from "@/lib/budget";
import { evaluate } from "@/lib/budget/eval";
import { adjustmentsByAccount } from "@/lib/budget/changes";
import { cn } from "@/lib/ui/utils";
import { fmt, prettyFormula, normalizeFormula } from "./budget-helpers";
import type { Budget, Evaluated, ApiFn, MutateFn, CellArgs, FormulaArgs, CellFn, FormulaFn } from "./budget-types";

interface Opts {
  grid: BudgetGrid;
  isAdmin: boolean;
  budget: Budget;
  setBudget: React.Dispatch<React.SetStateAction<Budget>>;
  /** The page's `useMutation().mutate` — the shared write path, error message
   *  and all. Passed in rather than taken here so a cell edit shares the page's
   *  busy scope instead of opening a second one. */
  mutate: MutateFn;
  load: () => Promise<void>;
  api: ApiFn;
}

export function useBudgetCells({ grid, isAdmin, budget, setBudget, mutate, load, api }: Opts) {
  // Buffered in-progress cell edits, keyed `${id}:${field}`.
  const [pending, setPending] = useState<Record<string, string>>({});
  // Which formula cell is currently focused (shows the formula instead of the value).
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const pVal = (id: string, field: string, actual: string) => pending[`${id}:${field}`] ?? actual;
  const setP = (id: string, field: string, v: string) => setPending((p) => ({ ...p, [`${id}:${field}`]: v }));
  const clearP = (id: string, field: string) => setPending((p) => { const n = { ...p }; delete n[`${id}:${field}`]; return n; });

  // A cell edit shouldn’t refetch (and re-evaluate) the whole budget — that’s
  // a PATCH plus two GETs per keystroke-commit. Instead we apply the change to
  // local state, re-run the evaluator on the client (same `evaluate` the server
  // uses), and fire the PATCH in the background, only reloading if it fails.

  // Re-derive `evaluated` from the budget’s own data (actuals are untouched).
  function recompute(rev: Budget): Budget {
    const varInputs = rev.variables.map((v) => ({ name: v.name, expression: v.expression }));
    const liInputs = rev.costCenters.flatMap((cc) =>
      cc.accounts.flatMap((a) =>
        a.lineItems.map((li) => ({ id: li.id, accountKey: `${sheetKey(cc)}:${a.accountCode}`, expression: li.expression, values: li.values })),
      ),
    );
    // Editorial changes are part of every account total the server sends,
    // so they have to be part of the one computed here too — otherwise editing
    // any cell would silently drop them until the next reload. (Cells are only
    // editable while the budget is unlocked, and changes are only made while it
    // is locked; but an unlocked budget still carries the ones made earlier.)
    const netByAccount = adjustmentsByAccount(rev.changes);
    const adjustments = rev.costCenters.flatMap((cc) =>
      cc.accounts.flatMap((a) => {
        const amount = netByAccount.get(a.id);
        return amount === undefined || amount === 0
          ? []
          : [{ accountKey: `${sheetKey(cc)}:${a.accountCode}`, amount }];
      }),
    );
    const knownAccounts = rev.costCenters.flatMap((cc) =>
      cc.accounts.map((a) => `${sheetKey(cc)}:${a.accountCode}`),
    );
    const r = evaluate(varInputs, liInputs, [...EXTRA_COLUMN_KEYS], adjustments, knownAccounts);
    const evaluated: Evaluated = {
      vars: Object.fromEntries(r.vars), accounts: Object.fromEntries(r.accounts),
      lineItems: Object.fromEntries(r.lineItems), cells: Object.fromEntries(r.cells),
      badLineItems: r.badLineItems, badVariables: r.badVariables, errors: r.errors,
    };
    return { ...rev, evaluated };
  }

  // Merge a columnValues patch the same way the server does (empty clears).
  function mergeValues(cur: Record<string, string>, patch: Record<string, string>): Record<string, string> {
    const merged = { ...(cur ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v !== "string") continue;
      if (v.trim() === "") delete merged[k]; else merged[k] = v.trim();
    }
    return merged;
  }

  // Apply a PATCH payload to local state by URL shape; null = not a known field edit.
  function applyLocal(rev: Budget, url: string, payload: Record<string, unknown>): Budget | null {
    const str = (k: string, fallback: string) => (typeof payload[k] === "string" ? (payload[k] as string) : fallback);
    let m: RegExpMatchArray | null;
    if ((m = url.match(/\/line-items\/([^/]+)$/))) {
      const id = m[1];
      return { ...rev, costCenters: rev.costCenters.map((cc) => ({ ...cc, accounts: cc.accounts.map((a) => ({ ...a,
        lineItems: a.lineItems.map((li) => li.id !== id ? li : {
          ...li,
          description: str("description", li.description),
          expression: str("expression", li.expression),
          values: payload.columnValues && typeof payload.columnValues === "object" ? mergeValues(li.values, payload.columnValues as Record<string, string>) : li.values,
        }) })) })) };
    }
    if ((m = url.match(/\/accounts\/([^/]+)$/))) {
      const id = m[1];
      return { ...rev, costCenters: rev.costCenters.map((cc) => ({ ...cc, accounts: cc.accounts.map((a) => a.id !== id ? a : {
        ...a, accountCode: str("accountCode", a.accountCode), accountName: str("accountName", a.accountName),
      }) })) };
    }
    if ((m = url.match(/\/variables\/([^/]+)$/))) {
      const id = m[1];
      return { ...rev, variables: rev.variables.map((v) => v.id !== id ? v : { ...v, name: str("name", v.name), expression: str("expression", v.expression) }) };
    }
    return null;
  }

  // The optimistic path: show the edit, then tell the server. It goes through
  // the same `mutate` as every other write in the app — it only asks it not to
  // refresh afterwards, because the new value is already on screen (see the
  // `refresh` option in components/use-mutation.ts). It used to be a bare
  // fetch, which meant it was also the one write in the app that printed the
  // server's error *code* at the reader instead of the sentence behind it.
  async function commitField(url: string, payload: Record<string, unknown>) {
    const next = applyLocal(budget, url, payload);
    if (!next) return void api(url, "PATCH", payload); // unknown shape → reload path
    setBudget(recompute(next));
    const ok = await mutate(url, { method: "PATCH", body: payload, refresh: false });
    if (!ok) await load(); // rejected: the screen is ahead of the server, resync
  }

  async function commit(id: string, field: string, actual: string, url: string, payload: (v: string) => Record<string, unknown>) {
    const key = `${id}:${field}`;
    const v = pending[key];
    if (v === undefined || v.trim() === actual.trim()) { clearP(id, field); return; }
    clearP(id, field);
    await commitField(url, payload(v.trim()));
  }

  // Commit a formula cell: turn the typed A1 form back into stored row-bound
  // tokens, then PATCH if it actually changed.
  async function commitFormula(id: string, field: string, raw: string, sheet: string, url: string, payload: (v: string) => Record<string, unknown>) {
    const key = `${id}:${field}`;
    setFocusKey((k) => (k === key ? null : k));
    const typed = pending[key];
    if (typed === undefined) return;
    // Forgiving entry: "2x3x12" / "8 × TACK_POLICY" → a formula, before we bind
    // any A1 references to their row-stable tokens.
    const stored = toStored(normalizeFormula(typed), sheet, grid);
    clearP(id, field);
    if (stored.trim() === raw.trim()) return;
    await commitField(url, payload(stored));
  }

  // An editable text cell (admin only); otherwise a static value. Invoked as a
  // plain function (not <Cell/>) so the <input> reconciles by position and keeps
  // focus across re-renders instead of remounting on every keystroke.
  const renderCell: CellFn = ({ id, field, actual, className, placeholder, mono, url, payload, gated }: CellArgs) => {
    if (!isAdmin) {
      return <div className={cn("px-2 py-1.5 min-h-8", mono && "font-mono text-xs", className)}>{actual || <span className="text-muted/40">{placeholder}</span>}</div>;
    }
    return (
      <input
        data-cell={gated ? `${id}:${field}` : undefined}
        value={pVal(id, field, actual)}
        onChange={(e) => setP(id, field, e.target.value)}
        onBlur={() => commit(id, field, actual, url, payload)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") clearP(id, field); }}
        placeholder={placeholder}
        className={cn("w-full bg-transparent px-2 py-1.5 outline-none", mono && "font-mono text-xs", className)}
      />
    );
  };

  // A spreadsheet-style cell: shows the evaluated value when idle, the formula
  // (in A1 form, with a leading "=") while focused. `raw` is the stored string,
  // `computed` the evaluated number, `sheet` the cost-centre code for ref scope.
  const renderFormula: FormulaFn = ({ id, field, raw, computed, sheet, bad, placeholder, url, payload, className, display = "value", gated }: FormulaArgs) => {
    const key = `${id}:${field}`;
    const focused = focusKey === key;
    const empty = raw.trim() === "";
    const isFormula = raw.trim().startsWith("=");
    const formulaText = toDisplay(raw, sheet, grid);
    // The equation without "=", e.g. "2 × TROJA_POLICY" — shown while editing and
    // (on the Belopp column) idle, suffixed with its evaluated result.
    const pretty = isFormula ? prettyFormula(formulaText) : formulaText;
    const asFormula = display === "formula" || focused;
    const idle = empty
      ? (placeholder ?? "")
      : display === "formula"
        ? (pretty || raw)
        : bad
          ? "fel"
          : isFormula
            ? `${pretty} = ${fmt(computed)}`
            : fmt(computed);
    if (!isAdmin) {
      return <div className={cn("px-2 py-1.5 min-h-8", display === "formula" ? "font-mono text-xs" : "text-right tabular-nums", empty && "text-muted/40", bad && !empty && "text-danger", className)} title={isFormula ? formulaText : undefined}>{idle}</div>;
    }
    return (
      <input
        data-cell={gated ? key : undefined}
        value={focused ? (pending[key] ?? pretty) : empty ? "" : idle}
        placeholder={placeholder}
        title={isFormula && !focused ? formulaText : undefined}
        // Focusing swaps the display to the formula, so the caret is placed after
        // that re-render. A gated cell is only *selected* on focus (edit mode comes
        // later, on Enter) — leave a collapsed caret, not a select-all highlight.
        onFocus={(e) => {
          setFocusKey(key);
          if (pending[key] === undefined) setP(id, field, pretty);
          const el = e.currentTarget;
          requestAnimationFrame(() => { if (gated) el.setSelectionRange(el.value.length, el.value.length); else el.select(); });
        }}
        onChange={(e) => setP(id, field, e.target.value)}
        onBlur={() => commitFormula(id, field, raw, sheet, url, payload)}
        // Escape reverts the buffered text; the cell stays focused, so `focusKey`
        // must stay set. Clearing it here left a focused cell rendering its idle
        // text ("fel" on a bad formula) — and the next Enter would then edit, and
        // commit, that display string instead of the formula. Only blur clears it.
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") clearP(id, field); }}
        className={cn(
          "w-full bg-transparent px-2 py-1.5 outline-none placeholder:text-muted/40",
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
