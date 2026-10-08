// The variables sheet: named values/expressions referenceable from any cell.
// Its two editable columns are gated cells, so they select and edit exactly like
// a cost-centre sheet (Enter edits; Tab moves natively).
//
// Variables are a flat namespace, matched across budgets on the name alone, so
// when a comparison is on this shows the other side's value beside each, and,
// below, the ones only the other side defines. A budget whose MEDLEMMAR the
// section has grown out of is worth seeing.
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { IconButton } from "@/components/ui/icon-button";
import { TableScroll } from "@/components/ui/table-scroll";
import { IconTrash } from "@/components/ui/icons";
// Variables are not money: MEDLEMMAR is a headcount, a policy figure may be a
// share, so they are printed as the numbers they are rather than converted
// from öre. See `fmtScalar` in budget-helpers.
import { fmtScalar } from "./budget-helpers";
import { useCellEdit } from "./use-cell-edit";
import type { Comparison } from "./use-comparison";
import { withVariable, withoutVariable } from "./patch-budget";
import type { Budget, Evaluated, CellFn, FormulaFn, ApiFn, Variable } from "./budget-types";

export function VariablesSheet({ budget, ev, comparison, isAdmin, renderCell, renderFormula, api, newVar, setNewVar, budgetId }: {
  budget: Budget; ev: Evaluated; comparison: Comparison;
  isAdmin: boolean; renderCell: CellFn; renderFormula: FormulaFn; api: ApiFn;
  newVar: string; setNewVar: (v: string) => void; budgetId: string;
}) {
  const t = useTranslations("budget.variables");
  const tRam = useTranslations("budget.rambudget");
  const cellEdit = useCellEdit("budget-grid overflow-hidden rounded-panel border border-border bg-background");
  const showCompare = comparison.otherLabel !== null;
  const own = new Set(budget.variables.map((v) => v.name));
  const compareValue = new Map(comparison.joined.vars.map((v) => [v.name, v.values[1]]));
  const ghosts = showCompare ? comparison.joined.vars.filter((v) => !own.has(v.name)) : [];

  return (
    <div {...cellEdit}>
      <TableScroll minWidth="min-w-[34rem]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-muted">
            <th className="w-52 px-3 py-2">{t("name")}</th>
            <th className="px-3 py-2">{t("expression")}</th>
            <th className="w-28 px-3 py-2 text-right">{t("value")}</th>
            {showCompare && <th className="w-32 px-3 py-2 text-right">{comparison.otherLabel}</th>}
            {isAdmin && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {budget.variables.map((v) => {
            const url = `/api/budget-variables/${v.id}`;
            const bad = ev.badVariables?.includes(v.name);
            return (
              <tr key={v.id} className="group border-b border-border/60">
                <td className="border-r border-border/60 p-0">
                  {renderCell({ id: v.id, field: "name", actual: v.name, mono: true, url, payload: (x) => ({ name: x.toUpperCase() }), gated: true })}
                </td>
                <td className="border-r border-border/60 p-0">
                  {renderFormula({ id: v.id, field: "expression", raw: v.expression, computed: ev.vars[v.name], unit: "scalar", sheet: "", display: "formula", bad, url, payload: (x) => ({ expression: x }), gated: true })}
                </td>
                <td className={cn("px-3 py-1.5 text-right tabular-nums", bad && "text-danger")}>{fmtScalar(ev.vars[v.name])}</td>
                {showCompare && (
                  <td className="border-l border-border/40 px-3 py-1.5 text-right tabular-nums text-muted">
                    {fmtScalar(compareValue.get(v.name))}
                  </td>
                )}
                {isAdmin && (
                  <td className="px-1 text-center">
                    <IconButton tone="danger" reveal label={t("remove")} onClick={() => api(url, "DELETE", undefined, (b) => withoutVariable(b, v.id))}>
                      <IconTrash className="size-4" />
                    </IconButton>
                  </td>
                )}
              </tr>
            );
          })}

          {/* Defined over there and not here. Read-only: pulling one across is a
              decision about this budget, not a display detail. */}
          {ghosts.map((v) => (
            <tr key={`ghost-${v.name}`} className="border-b border-border/60 text-muted">
              <td className="border-r border-border/60 px-3 py-1.5 font-mono text-xs">{v.name}</td>
              <td className="border-r border-border/60 px-3 py-1.5 text-xs">– {tRam("notInThisBudget")}</td>
              <td />
              <td className="border-l border-border/40 px-3 py-1.5 text-right tabular-nums">{fmtScalar(v.values[1])}</td>
              {isAdmin && <td />}
            </tr>
          ))}

          {isAdmin && (
            <tr className="border-b border-border/60">
              <td className="border-r border-border/60 p-0" colSpan={2}>
                <input
                  aria-label={t("addPlaceholder")}
                  value={newVar}
                  onChange={(e) => setNewVar(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter" || !newVar.trim()) return;
                    const ok = await api(
                      `/api/budgets/${budgetId}/variables`,
                      "POST",
                      { name: newVar.trim().toUpperCase(), expression: "0" },
                      (b, data) => withVariable(b, data as Variable),
                    );
                    if (ok) setNewVar("");
                  }}
                  placeholder={t("addPlaceholder")}
                  className="w-full bg-transparent px-3 py-1.5 font-mono text-xs outline-none placeholder:text-muted focus:bg-accent-soft/40"
                />
              </td>
              <td /><td />
              {showCompare && <td />}
            </tr>
          )}
        </tbody>
      </table>
      </TableScroll>
    </div>
  );
}
