"use client";

// The comparison table. Everything it needs is joined and totalled before it
// gets here. This file is the rendering, the "remove this column" buttons and
// the "add another" picker, and those three all work by changing the URL.

import { useMemo } from "react";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { EmptyNote } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { IconTrash } from "@/components/ui/icons";
import { TableScroll } from "@/components/ui/table-scroll";
import {
  joinSnapshots, sheetTotals,
  type JoinedAccount, type JoinedSheet, type Snapshot,
} from "@/lib/budget/compare";
import { fmt, fmtSigned } from "../[budgetId]/budget-helpers";
import { cn } from "@/lib/ui/utils";

// Spreadsheet notation: whole kronor, no unit, and not the app's `Amount`.
// This is a budget sheet held up against another budget sheet, and the figures
// have to read as the same figures they do on /budget/[id]: a column of
// "1 247,50 kr" beside a column of "1 247" is two different documents. Amount is
// for the places money is a value in a list; here it is a cell in a grid.
function Cell({ value, className }: { value: number | undefined; className?: string }) {
  return (
    <td className={cn("px-4 py-2 text-right tabular-nums", className)}>
      {value !== undefined ? fmt(value) : <span className="text-muted">–</span>}
    </td>
  );
}

// Only meaningful between two columns: with three or more, "the" difference is
// not a number anyone asked for. So the column appears when there are exactly
// two budgets and not otherwise.
function Diff({ values, className }: { values: (number | undefined)[]; className?: string }) {
  const diff = (values[1] ?? 0) - (values[0] ?? 0);
  if (diff === 0) return <td className={cn("px-4 py-2 text-right tabular-nums text-muted", className)}>–</td>;
  return (
    <td className={cn("px-4 py-2 text-right tabular-nums", diff > 0 ? "text-success" : "text-danger", className)}>
      {fmtSigned(diff)}
    </td>
  );
}

export function CompareClient({
  ids,
  snapshots,
  options,
}: {
  /** The budgets being compared, in the order the URL names them. */
  ids: string[];
  snapshots: Snapshot[];
  /** Every budget not already a column, for the "add another" picker. */
  options: { value: string; label: string }[];
}) {
  const router = useProgressRouter();
  const t = useTranslations("budget.compare");

  // The comparison lives in the URL, so changing it is a navigation, which is
  // also what re-runs the page's loader and brings back the new column.
  const setIds = (next: string[]) =>
    router.replace(next.length ? `/budget/compare?b=${next.join(",")}` : "/budget/compare");

  const joined = useMemo(() => joinSnapshots(snapshots), [snapshots]);
  const n = snapshots.length;
  const showDiff = n === 2;
  const cols = 1 + n + (showDiff ? 1 : 0);

  return (
    <PageShell
      title={t("title")}
      description={t("description")}
      back="/budget"
      width="content"
    >
      {/* The picker sits on the card it fills rather than in the page header,
          and the card is rendered even before there is anything to compare.
          reaching two budgets is what the picker is for, so it cannot be behind
          the same condition as the table. */}
      <Card>
        <CardHeader
          title={t("included")}
          action={
            <Combobox
              options={options}
              value=""
              onChange={(v) => v && setIds([...ids, v])}
              placeholder={t("addBudget")}
              searchPlaceholder={t("searchBudget")}
              emptyText={t("noMoreBudgets")}
              aria-label={t("addBudgetAria")}
              className="w-64"
            />
          }
        />
        {n < 2 ? (
          <EmptyNote>{t("pickTwo")}</EmptyNote>
        ) : (
          <TableScroll minWidth="min-w-[38rem]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th className="px-4 py-3">{t("colRow")}</th>
                  {snapshots.map((s, i) => (
                    <th key={s.id} className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1">
                        {s.label}
                        <IconButton
                          label={t("removeFromComparison", { label: s.label })}
                          tone="danger"
                          onClick={() => setIds(ids.filter((_, j) => j !== i))}
                        >
                          <IconTrash className="size-3.5" />
                        </IconButton>
                      </span>
                    </th>
                  ))}
                  {showDiff && <th className="px-4 py-3 text-right">{t("difference")}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {joined.vars.length > 0 && (
                  <>
                    <SectionHeader label={t("variables")} cols={cols} />
                    {joined.vars.map((v) => (
                      <tr key={v.name} className={cn("hover:bg-hover", differs(v.values) && "bg-warning/5")}>
                        <td className="px-4 py-2 font-mono text-xs font-semibold">{v.name}</td>
                        {v.values.map((value, i) => <Cell key={i} value={value} />)}
                        {showDiff && <Diff values={v.values} />}
                      </tr>
                    ))}
                  </>
                )}

                {joined.sheets.map((sheet) => (
                  <SheetRows
                    key={sheet.key}
                    sheet={sheet}
                    n={n}
                    cols={cols}
                    showDiff={showDiff}
                  />
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </PageShell>
  );
}

// Highlight a row where the sides disagree, including "one has it, one
// doesn't", which is a disagreement of the most interesting kind.
const differs = (values: (number | undefined)[]) =>
  values.some((v) => v !== values[0]);

function SectionHeader({ label, cols }: { label: string; cols: number }) {
  return (
    <tr className="bg-surface">
      <td colSpan={cols} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </td>
    </tr>
  );
}

function SheetRows({ sheet, n, cols, showDiff }: {
  sheet: JoinedSheet; n: number; cols: number; showDiff: boolean;
}) {
  const t = useTranslations("budget.compare");
  // The result (income − cost) per side, which is the only sheet-level figure
  // that means the same thing whichever accounts each side happens to hold.
  const results = Array.from({ length: n }, (_, i) => sheetTotals(sheet, i).result);
  const label = /^[@#]/.test(sheet.key) ? sheet.name : `${sheet.key} – ${sheet.name}`;

  return (
    <>
      <SectionHeader label={label} cols={cols} />
      <tr className="font-semibold">
        <td className="px-4 py-2">{t("result")}</td>
        {results.map((v, i) => <Cell key={i} value={sheet.present[i] ? v : undefined} />)}
        {showDiff && <Diff values={results} />}
      </tr>
      {sheet.accounts.map((account) => (
        <AccountRows key={account.code} account={account} showDiff={showDiff} />
      ))}
    </>
  );
}

function AccountRows({ account, showDiff }: { account: JoinedAccount; showDiff: boolean }) {
  return (
    <>
      <tr className={cn("bg-surface", differs(account.totals) && "bg-warning/5")}>
        <td className="px-4 py-2 pl-8">
          <span className="mr-2 font-mono text-xs font-semibold text-muted">{account.code}</span>
          {account.name}
        </td>
        {account.totals.map((v, i) => <Cell key={i} value={v} className="font-medium" />)}
        {showDiff && <Diff values={account.totals} className="font-medium" />}
      </tr>
      {account.lines.map((line) => (
        <tr key={line.key} className={cn("text-muted hover:bg-hover", differs(line.values) && "bg-warning/5")}>
          <td className="px-4 py-2 pl-14 text-xs">{line.description || "–"}</td>
          {line.values.map((v, i) => <Cell key={i} value={v} className="text-xs" />)}
          {showDiff && <Diff values={line.values} className="text-xs" />}
        </tr>
      ))}
    </>
  );
}
