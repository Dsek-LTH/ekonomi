"use client";

// The report's grid on CSS grid: the group cards share ONE sideways scrollport, so column alignment is structural.
// From lg it also scrolls down (the page is sized to the window, see useFillViewport in ledger-client.tsx).
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { formatPercent, resultTone, rowValue, totalValue } from "./report-view";
import type {
  GroupMode,
  LedgerReport,
  ReportAccount,
  ReportGroup,
  ReportSection,
  ResultColumn,
  RowView,
} from "./report-types";
import { RESULT_COLUMNS } from "./report-types";

export interface Shape {
  isBalance: boolean;
  showComparison: boolean;
  comparisonLabel: string;
  diff: boolean; // the difference column beside the comparison
  columns: readonly ResultColumn[];
}

// One description of the columns for the whole report, as grid tracks on a custom property every grid reads.
interface ColumnSpec {
  key:
    | "account"
    | "opening"
    | "amount"
    | "closing"
    | "accumulated"
    | "prior"
    | "priorAccumulated"
    | "priorDiff"
    | "comparison"
    | "diff";
  /** A key under `ledger.col`, except `comparison`, whose heading names the
   *  thing being compared against and is built by the client. */
  label: string;
  width: number | null; // rem; null = takes the remaining width
}

const ACCOUNT_MIN = 14; // rem, the floor the account column shrinks to

export function reportColumns(shape: Shape): ColumnSpec[] {
  const cols: ColumnSpec[] = [{ key: "account", label: "account", width: null }];
  if (shape.isBalance) {
    cols.push(
      { key: "opening", label: "opening", width: 9 },
      { key: "amount", label: "period", width: 9 },
      { key: "closing", label: "closing", width: 9 },
    );
  } else {
    // The reader's pick in fixed order; with nothing picked the period is shown.
    const picked = RESULT_COLUMNS.filter((c) => shape.columns.includes(c));
    for (const c of picked.length ? picked : (["period"] as const)) {
      cols.push(
        c === "period"
          ? { key: "amount", label: "amount", width: 9 }
          : { key: c, label: c, width: 9 },
      );
    }
  }
  if (shape.showComparison) {
    // Already worded by the client. See `comparisonLabel` on Shape.
    cols.push({ key: "comparison", label: shape.comparisonLabel, width: 9 });
    if (shape.diff) cols.push({ key: "diff", label: "diff", width: 9 });
  }
  return cols;
}

// Set on whatever wraps the report; everything below reads these two.
export function reportSurfaceVars(cols: ColumnSpec[]): React.CSSProperties {
  return {
    "--report-cols": cols
      .map((c) => (c.width ? `${c.width}rem` : `minmax(${ACCOUNT_MIN}rem, 1fr)`))
      .join(" "),
    "--report-min-w": `${cols.reduce((sum, c) => sum + (c.width ?? ACCOUNT_MIN), 0)}rem`,
  } as React.CSSProperties;
}

const GRID = "grid grid-cols-[var(--report-cols)]";
// A row spans every track and hands them back to its cells, so rows align without repeating the track list.
// `items-center` because the diff cell is two lines.
const ROW = "col-span-full grid grid-cols-subgrid items-center";

const AMOUNT_CELL = "px-3 py-2 text-right tabular-nums whitespace-nowrap last:pr-inset";

// The report's scrollport: sideways at every width, down from lg (given the height left in the window). On paper nothing scrolls.
export function ReportScroller({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto overscroll-contain lg:overflow-y-auto print:overflow-visible",
        className,
      )}
    >
      <div className="min-w-[var(--report-min-w)] print:min-w-0">{children}</div>
    </div>
  );
}

// The difference against the comparison column, with relative change under it. No colour: above budget is not
// good or bad news without knowing the side of the report.
function Diff({ value, against }: { value: number; against: number | null }) {
  if (against == null) return null;
  const diff = value - against;
  const pct = against === 0 ? null : diff / Math.abs(against);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{diff > 0 ? `+${formatSEK(diff)}` : formatSEK(diff)}</span>
      {pct != null && (
        <span className="text-xs text-muted">
          {diff > 0 ? "+" : ""}
          {formatPercent(pct, 0)}
        </span>
      )}
    </span>
  );
}

// Every totalling row (section sum, cost-centre heading, bottom line) goes through one renderer so they agree on
// columns. A figure column reads off a line, account or total alike; `period` is passed in because an account
// calls it `amount` and a total `total`.
function figure(
  key: ColumnSpec["key"],
  line: {
    opening: number | null;
    closing: number | null;
    comparison: number | null;
    accumulated: number | null;
    prior: number | null;
    priorAccumulated: number | null;
  },
  period: number,
): number | null {
  switch (key) {
    case "opening":
      return line.opening ?? 0;
    case "closing":
      return line.closing ?? 0;
    case "comparison":
      return line.comparison;
    case "accumulated":
      return line.accumulated;
    case "prior":
      return line.prior;
    case "priorAccumulated":
      return line.priorAccumulated;
    default:
      return period;
  }
}

function SummaryRow({
  cols,
  shape,
  label,
  value,
  tone,
  className,
  cellClassName,
}: {
  cols: ColumnSpec[];
  shape: Shape;
  label: React.ReactNode;
  value: {
    total: number;
    opening: number | null;
    closing: number | null;
    comparison: number | null;
    accumulated: number | null;
    prior: number | null;
    priorAccumulated: number | null;
  };
  tone?: boolean;
  className?: string;
  cellClassName?: string;
}) {
  const { isBalance } = shape;
  const result = totalValue(value, isBalance);
  // On a result report the period column *is* the result; on a balance report
  // that column is the period's movement and the result is the closing balance.
  const resultKey = isBalance ? "closing" : "amount";

  return (
    <div role="row" className={cn(ROW, className)}>
      {cols.map((c) => {
        if (c.key === "account") {
          return (
            <div key={c.key} role="cell" className="min-w-0 py-2 pl-inset pr-3">
              {label}
            </div>
          );
        }
        if (c.key === "diff" || c.key === "priorDiff") {
          return (
            <div key={c.key} role="cell" className={cn(AMOUNT_CELL, cellClassName)}>
              {c.key === "diff" ? (
                <Diff value={result} against={value.comparison} />
              ) : (
                <Diff value={value.total} against={value.prior} />
              )}
            </div>
          );
        }
        const amount = figure(c.key, value, value.total);
        return (
          <div
            key={c.key}
            role="cell"
            className={cn(
              AMOUNT_CELL,
              cellClassName,
              tone && c.key === resultKey && resultTone(result),
              tone && c.key === "comparison" && resultTone(value.comparison ?? 0),
            )}
          >
            {amount == null ? "" : formatSEK(amount)}
          </div>
        );
      })}
    </div>
  );
}

const SKELETON_NAMES = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-1/3", "w-1/2"];

/** The report while it loads: same card, column grid and real headings (from the same `Shape`), rows shimmering. */
export function ReportSkeleton({ shape }: { shape: Shape }) {
  const t = useTranslations("ledger");
  const cols = reportColumns(shape);
  return (
    <Card className="overflow-hidden" aria-busy="true">
      <div className={cn(GRID, "text-sm")}>
        <div className={cn(ROW, "border-b border-border text-xs text-muted")}>
          {cols.map((c) => (
            <div
              key={c.key}
              className={cn(
                "py-2.5 font-medium",
                c.key === "account" ? "pl-inset pr-3" : cn(AMOUNT_CELL, "py-2.5"),
              )}
            >
              {c.key === "comparison" ? c.label : t(`col.${c.label}`)}
            </div>
          ))}
        </div>
        {[7, 5].map((count, s) => (
          <Fragment key={s}>
            {/* Not on the tinted band the real heading has: the shimmer would vanish on it. */}
            <div className="col-span-full border-t border-border px-inset py-2.5">
              <Skeleton className="h-3 w-28" />
            </div>
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className={cn(ROW, "border-t border-border")}>
                {cols.map((c) =>
                  c.key === "account" ? (
                    <div key={c.key} className="py-3 pl-inset pr-3">
                      <Skeleton
                        className={cn("h-3.5", SKELETON_NAMES[(i + s * 3) % SKELETON_NAMES.length])}
                      />
                    </div>
                  ) : (
                    <div key={c.key} className="flex justify-end px-3 py-3 last:pr-inset">
                      <Skeleton className="h-3.5 w-16" />
                    </div>
                  ),
                )}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </Card>
  );
}

export function ReportGroupCard({
  group,
  groupMode,
  shape,
  openKey,
  rows,
  onToggle,
}: {
  group: ReportGroup;
  groupMode: GroupMode;
  shape: Shape;
  openKey: string | null;
  rows: Record<string, RowView[]>;
  onToggle: (group: ReportGroup, account: ReportAccount) => void;
}) {
  const t = useTranslations("ledger");
  const cols = reportColumns(shape);

  return (
    <Card className="overflow-hidden print:overflow-visible">
      <div role="table" className={cn(GRID, "text-sm")}>
        {groupMode === "SPECIFIED" && (
          <SummaryRow
            cols={cols}
            shape={shape}
            tone
            label={
              <span className="block truncate font-semibold">
                {group.costCenterCode
                  ? `${group.costCenterCode} - ${group.costCenterName ?? ""}`
                  : t("noCostCenter")}
              </span>
            }
            value={group}
            className="border-b border-border py-1 font-semibold"
          />
        )}

        <div role="row" className={cn(ROW, "border-b border-border text-xs text-muted")}>
          {cols.map((c) => (
            <div
              key={c.key}
              role="columnheader"
              className={cn(
                "py-2.5 font-medium",
                c.key === "account" ? "pl-inset pr-3" : cn(AMOUNT_CELL, "py-2.5"),
              )}
            >
              {c.key === "comparison" ? c.label : t(`col.${c.label}`)}
            </div>
          ))}
        </div>

        {group.sections.map((section) => (
          <SectionRows
            key={section.key}
            section={section}
            group={group}
            groupMode={groupMode}
            shape={shape}
            cols={cols}
            openKey={openKey}
            rows={rows}
            onToggle={onToggle}
          />
        ))}
      </div>
    </Card>
  );
}

// The bottom line on the same tracks as the cards, last in the scrollport (not pinned) as a printed report puts it,
// so it moves sideways with its columns.
export function ReportResult({
  report,
  shape,
  label,
}: {
  report: LedgerReport;
  shape: Shape;
  label: string;
}) {
  const cols = reportColumns(shape);
  return (
    <Card className="overflow-hidden">
      <div role="table" className={cn(GRID, "text-sm")}>
        <SummaryRow
          cols={cols}
          shape={shape}
          tone
          label={<span className="font-semibold">{label}</span>}
          value={report}
          className="py-1"
          cellClassName="font-semibold"
        />
      </div>
    </Card>
  );
}

function SectionRows({
  section,
  group,
  groupMode,
  shape,
  cols,
  openKey,
  rows,
  onToggle,
}: {
  section: ReportSection;
  group: ReportGroup;
  groupMode: GroupMode;
  shape: Shape;
  cols: ColumnSpec[];
  openKey: string | null;
  rows: Record<string, RowView[]>;
  onToggle: (group: ReportGroup, account: ReportAccount) => void;
}) {
  const t = useTranslations("ledger");
  const { isBalance } = shape;

  return (
    <Fragment>
      <div role="row" className="col-span-full border-t border-border bg-surface">
        <div role="cell" aria-colspan={cols.length} className="px-inset py-2 text-xs font-medium">
          {t(`section.${section.key}`)}
        </div>
      </div>

      {section.accounts.map((a) => {
        const key = `${group.costCenterCode ?? ""}|${a.account}`;
        const open = openKey === key;
        const value = rowValue(a, isBalance);
        return (
          <Fragment key={key}>
            {/* The expander is a real button, not an onClick on role="row" (no tab stop). Its hit area is stretched
                over the row via `after:`. */}
            <div
              role="row"
              className={cn(
                ROW,
                "group relative cursor-pointer border-t border-border hover:bg-hover focus-within:bg-surface",
                open && "bg-surface",
              )}
            >
              <div role="cell" className="min-w-0 py-2 pl-inset pr-3">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onToggle(group, a)}
                  className="cursor-pointer text-left after:absolute after:inset-0 after:content-['']"
                >
                  <span className="font-medium tabular-nums">{a.account}</span>{" "}
                  <span className="text-muted">{a.accountName}</span>
                </button>
              </div>
              {cols.slice(1).map((c) => {
                if (c.key === "diff" || c.key === "priorDiff") {
                  return (
                    <div key={c.key} role="cell" className={AMOUNT_CELL}>
                      {c.key === "diff" ? (
                        <Diff value={value} against={a.comparison} />
                      ) : (
                        <Diff value={a.amount} against={a.prior} />
                      )}
                    </div>
                  );
                }
                const amount = figure(c.key, a, a.amount);
                // The figure the row is read by stands out; the rest are context.
                const lead = isBalance ? c.key === "closing" : c.key === "amount";
                return (
                  <div
                    key={c.key}
                    role="cell"
                    className={cn(AMOUNT_CELL, lead ? "font-medium" : "text-muted")}
                  >
                    {amount == null ? "" : formatSEK(amount)}
                  </div>
                );
              })}
            </div>

            {open && (
              <div role="row" className="col-span-full border-t border-border bg-surface">
                <div role="cell" aria-colspan={cols.length} className="px-inset py-3">
                  <VoucherRows rows={rows[key]} showCostCenter={groupMode === "SUMMED"} />
                </div>
              </div>
            )}
          </Fragment>
        );
      })}

      <SummaryRow
        cols={cols}
        shape={shape}
        label={<span className="font-medium">{t(`sectionTotal.${section.key}`)}</span>}
        value={section}
        className="border-t border-border"
        cellClassName="font-medium"
      />
    </Fragment>
  );
}

// The voucher rows behind one account, fetched on first expand: its own small table, unrelated to the report's grid.
function VoucherRows({
  rows,
  showCostCenter,
}: {
  rows: RowView[] | undefined;
  showCostCenter: boolean;
}) {
  const t = useTranslations("ledger");
  const { date } = useFormat();
  if (!rows) return <p className="text-xs text-muted">{t("loadingVouchers")}</p>;
  if (rows.length === 0) return <p className="text-xs text-muted">{t("noVoucherRows")}</p>;
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="text-muted">
            <td className="py-1 pr-3 whitespace-nowrap">{date(r.date)}</td>
            <td className="py-1 pr-3 whitespace-nowrap font-medium text-foreground">{r.voucher}</td>
            <td className="py-1 pr-3">{r.text || r.description}</td>
            {showCostCenter && (
              <td className="py-1 pr-3 whitespace-nowrap">{r.costCenter ?? "-"}</td>
            )}
            <td className="py-1 pr-3 text-right tabular-nums whitespace-nowrap">
              {r.debit ? formatSEK(r.debit) : ""}
            </td>
            <td className="py-1 text-right tabular-nums whitespace-nowrap">
              {r.credit ? formatSEK(r.credit) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
