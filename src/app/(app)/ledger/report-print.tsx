"use client";

// The report as it comes out of the printer, in Fortnox's form: the header with
// where the figures came from, then the report laid out by print-layout.
//
// Only on paper (`hidden print:block`). The screen keeps its own table, which
// is built for searching and drilling into rows. What prints is still exactly
// what is on screen: the same filtered report, and the same columns the
// settings and the chips above the table turned on.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/ui/utils";
import { printLines, type Figures, type PrintLine } from "./print-layout";
import type { LedgerReport, ResultColumn, ViewOptions } from "./report-types";
import { RESULT_COLUMNS } from "./report-types";

// Fortnox's figures: two decimals, a space between thousands, no currency
// (the header says SEK once).
const NUMBER = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = (v: number | null) => (v == null ? "" : NUMBER.format(v));

/** "2026-10-06, 21:47", the moment the print was asked for. */
function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Column =
  | "opening"
  | "amount"
  | "closing"
  | "prior"
  | "priorAccumulated"
  | "priorDiff"
  | "comparison"
  | "accumulated"
  | "diff";

export function ReportPrint({
  report,
  view,
  columns: picked,
  showComparison,
  comparison,
  companyName,
  orgNumber,
  latestVouchers,
  financialYear,
  period,
  costCenter,
  comparedWith,
}: {
  report: LedgerReport;
  view: ViewOptions;
  /** The result report's figure columns, as on screen. */
  columns: readonly ResultColumn[];
  showComparison: boolean;
  /** Which comparison is on show, for the column headings. */
  comparison: "PRIOR" | "BUDGET" | "NONE";
  companyName: string | null;
  orgNumber: string | null;
  latestVouchers: string[];
  financialYear: { from: string; to: string } | null;
  period: { from: string; to: string } | null;
  /** "SKT02 – Skattmästeriet", when the report is narrowed to one. */
  costCenter: string | null;
  /** The comparison named in full, e.g. "Budget – 2026 – Ursprunglig". */
  comparedWith: string | null;
}) {
  const t = useTranslations("ledger");
  const isBalance = report.kind === "BALANCE";

  // The time on the page is when it was printed, not when the page loaded.
  const [printedAt, setPrintedAt] = useState(() => new Date());
  useEffect(() => {
    const onPrint = () => setPrintedAt(new Date());
    window.addEventListener("beforeprint", onPrint);
    return () => window.removeEventListener("beforeprint", onPrint);
  }, []);

  const prior = comparison === "PRIOR";
  // The result report prints the columns picked on screen, in the same order.
  const resultColumns = RESULT_COLUMNS.filter((c) => picked.includes(c));
  const columns: Column[] = [
    ...(isBalance
      ? (["opening", "amount", "closing"] as const)
      : (resultColumns.length ? resultColumns : (["period"] as const)).map((c) =>
          c === "period" ? ("amount" as const) : c,
        )),
    ...(showComparison ? (["comparison"] as const) : []),
    ...(showComparison && view.diff ? (["diff"] as const) : []),
  ];
  const heading: Record<Column, string> = {
    opening: t("col.opening"),
    amount: t("col.period"),
    closing: t("col.closing"),
    comparison: prior ? t("printout.priorPeriod") : t("budget"),
    accumulated: t("col.accumulated"),
    prior: t("printout.priorPeriod"),
    priorAccumulated: t("col.priorAccumulated"),
    priorDiff: t("printout.diffPrior"),
    diff: prior ? t("printout.diffPrior") : t("printout.diffBudget"),
  };

  // The figure a line is read by: the period on a result report, the closing
  // balance on a balance one. What the deviation and the share are taken of.
  const value = (f: Figures) => (isBalance ? f.closing ?? 0 : f.amount);
  const cell = (c: Column, f: Figures) => {
    switch (c) {
      case "opening":
        return num(f.opening ?? 0);
      case "closing":
        return num(f.closing ?? 0);
      case "comparison":
        return num(f.comparison);
      case "accumulated":
        return num(f.accumulated);
      case "prior":
        return num(f.prior);
      case "priorAccumulated":
        return num(f.priorAccumulated);
      case "priorDiff":
        return f.prior == null ? "" : num(f.amount - f.prior);
      case "diff":
        return f.comparison == null ? "" : num(value(f) - f.comparison);
      default:
        return num(f.amount);
    }
  };

  const multiple = report.groups.length > 1;

  const row = (line: PrintLine, key: string) => {
    if (line.kind === "heading" || line.kind === "part") {
      return (
        <tr key={key}>
          <td
            colSpan={2 + columns.length}
            className={cn(
              "pt-2 font-semibold",
              line.kind === "heading" && "pt-3 text-[10pt]",
            )}
          >
            {t(`printout.layout.${line.label}`)}
          </td>
        </tr>
      );
    }
    if (line.kind === "account") {
      return (
        <tr key={key}>
          <td className="w-14 pr-2 align-top tabular-nums">{line.account.account}</td>
          <td className="pr-2 align-top">{line.account.accountName}</td>
          {columns.map((c) => (
            <td key={c} className="pl-3 text-right align-top tabular-nums whitespace-nowrap">
              {cell(c, line.account)}
            </td>
          ))}
        </tr>
      );
    }
    const label =
      line.kind === "partTotal"
        ? t("printout.partTotal", { part: t(`printout.layout.${line.label}`) })
        : t(`printout.layout.${line.label}`);
    return (
      <tr
        key={key}
        className={cn(
          "font-semibold",
          line.kind !== "partTotal" && "border-t border-black/40",
        )}
      >
        <td colSpan={2} className="pr-2 pb-1">
          {label}
        </td>
        {columns.map((c) => (
          <td key={c} className="pl-3 pb-1 text-right tabular-nums whitespace-nowrap">
            {cell(c, line.figures)}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div className="hidden text-[9pt] leading-snug text-black print:block">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3">
        {companyName && (
          <>
            <dt>{t("printout.company")}:</dt>
            <dd>{companyName}</dd>
          </>
        )}
        {orgNumber && (
          <>
            <dt>{t("printout.orgNumber")}:</dt>
            <dd>{orgNumber}</dd>
          </>
        )}
        <dt>{t("printout.generated")}:</dt>
        <dd>{stamp(printedAt)}</dd>
        {latestVouchers.length > 0 && (
          <>
            <dt>{t("printout.latestVoucher")}:</dt>
            <dd>{latestVouchers.join(" ")}</dd>
          </>
        )}
        <dt>{t("printout.currency")}:</dt>
        <dd>SEK</dd>
      </dl>

      <h2 className="mt-4 text-[14pt] font-semibold">
        {isBalance ? t("balanceReport") : t("resultReport")}
      </h2>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
        {financialYear && (
          <>
            <dt>{t("printout.financialYear")}:</dt>
            <dd>{`${financialYear.from} – ${financialYear.to}`}</dd>
          </>
        )}
        {period && (
          <>
            <dt>{t("printout.period")}:</dt>
            <dd>{`${period.from} – ${period.to}`}</dd>
          </>
        )}
        {costCenter && (
          <>
            <dt>{t("printout.costCenter")}:</dt>
            <dd>{costCenter}</dd>
          </>
        )}
        {comparedWith && (
          <>
            <dt>{t("printout.comparison")}:</dt>
            <dd>{comparedWith}</dd>
          </>
        )}
      </dl>

      <table className="mt-4 w-full border-collapse">
        <thead className="table-header-group">
          <tr className="border-b border-black/40">
            <th colSpan={2} />
            {columns.map((c) => (
              <th key={c} className="pb-1 pl-3 text-right font-semibold whitespace-nowrap">
                {heading[c]}
              </th>
            ))}
          </tr>
        </thead>
        {report.groups.map((g) => {
          const id = g.costCenterCode ?? "none";
          return (
            <tbody key={id} className="break-inside-auto">
              {/* Per cost centre, each its own report under its own name. */}
              {report.group === "SPECIFIED" && (
                <tr>
                  <td colSpan={2 + columns.length} className="pt-4 text-[11pt] font-semibold">
                    {g.costCenterCode
                      ? `${g.costCenterCode} – ${g.costCenterName ?? ""}`
                      : t("noCostCenter")}
                  </td>
                </tr>
              )}
              {printLines(g, report.kind).map((line, i) => row(line, `${id}-${i}`))}
            </tbody>
          );
        })}
        {/* Several cost centres: one line for all of them together. */}
        {multiple && (
          <tbody>
            {row(
              {
                kind: "result",
                label: "beraknatResultatTotalt",
                figures: {
                  amount: report.total,
                  opening: report.opening,
                  closing: report.closing,
                  comparison: report.comparison,
                  accumulated: report.accumulated,
                  prior: report.prior,
                  priorAccumulated: report.priorAccumulated,
                },
              },
              "all",
            )}
          </tbody>
        )}
      </table>
    </div>
  );
}
