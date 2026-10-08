"use client";

// The report's grid: one cost-centre group per card, the voucher rows behind
// any account one click away, and the bottom line under it all.
//
// Laid out on CSS grid rather than as tables, and, the part that matters, the
// group cards share ONE sideways scrollport instead of having one each. Column
// widths were never the hard part; two scroll containers were. Identically
// sized columns in two scrollports are aligned exactly until you scroll one of
// them, which is why the earlier per-card version needed JavaScript to keep
// fifty of them in step on every scroll event. With a single scrollport the
// alignment is structural and there is nothing to synchronise.
//
// From lg the same scrollport also scrolls down, and it is the only thing on
// the page that does: the page around it is sized to the window (see
// useFillViewport in ledger-client.tsx), so the parameters, the bar and the
// header stay put while the accounts move.
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
  /** Which figure columns a result report shows. See ResultColumn. */
  columns: readonly ResultColumn[];
}

// One description of the columns for the whole report. It becomes grid tracks
// on a custom property that every grid in the report reads, so a cost centre's
// rows, the next cost centre's and the bottom line are laid out by the same
// declaration rather than by three that have to agree.
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
    // The reader's pick, in the one order they always stand in. With nothing
    // picked the period is shown: a report of no figures is not a report.
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
// A row spans every track and hands them straight back to its own cells, so
// each row lines up with every other row in the report without repeating the
// track list. `items-center` because the diff cell is two lines and the figures
// beside it should sit against the middle of it, as table cells used to.
const ROW = "col-span-full grid grid-cols-subgrid items-center";

const AMOUNT_CELL = "px-3 py-2 text-right tabular-nums whitespace-nowrap last:pr-inset";

// The report's scrollport: sideways at every width, and down as well from lg,
// where it is given the height left over in the window and is the one part of
// the page that scrolls. On paper nothing scrolls and nothing has a minimum
// width. The page is as wide as it is.
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

// The difference against the comparison column, with the relative change under
// it. No colour: whether a number above budget is good news depends on which
// side of the report it sits on, and a green cost is a lie.
function Diff({ value, against }: { value: number; against: number | null }) {
  if (against == null) return null;
  const diff = value - against;
  const pct = against === 0 ? null : diff / Math.abs(against);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{diff > 0 ? `+${formatSEK(diff)}` : formatSEK(diff)}</span>
      {pct != null && (
        <span className="text-[11px] text-muted">
          {diff > 0 ? "+" : ""}
          {formatPercent(pct, 0)}
        </span>
      )}
    </span>
  );
}

// Every totalling row in the report (a section's sum, a cost centre's heading,
// the bottom line) is the same row with a different label and weight. One
// renderer, so they cannot end up disagreeing about which column a figure
// belongs under.
// What a figure column reads off a line, an account or a total alike. `period`
// is passed in because an account calls it `amount` and a total `total`.
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
  /** Colour the result figure green or red, only where the sign is the news. */
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

// Account-name bars of different lengths, so the placeholder reads as a list
// of accounts rather than as a grid of identical blocks.
const SKELETON_NAMES = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-1/3", "w-1/2"];

/**
 * The report while it loads: the same card, the same column grid and the real
 * column headings, with the rows still to come shimmering where they will be.
 *
 * Its own shape rather than the app's generic sheet, which was a card of a few
 * faint lines that looked like an empty report and then, a moment later, like a
 * different one. Switching between resultat- and balansrapport did that every
 * time. Drawn from the same `Shape` as the report that replaces it, so the
 * columns are already where the figures will land and nothing moves when they
 * do.
 */
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
            {/* A section heading. Not on the tinted band the real one has: the
                shimmer is drawn in that same tint and would vanish on it. */}
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
        {/* The cost-centre heading only exists in per-cost-centre grouping. Its
            figures sit in the columns they belong to, like the bottom line. */}
        {groupMode === "SPECIFIED" && (
          <SummaryRow
            cols={cols}
            shape={shape}
            tone
            label={
              <span className="block truncate font-semibold">
                {group.costCenterCode
                  ? `${group.costCenterCode} – ${group.costCenterName ?? ""}`
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

// The bottom line: the whole report's result, on the same tracks as the cards
// above it, so each total sits under the column it totals, the outcome under
// Belopp, the budget under Budget.
//
// The last thing in the report's scrollport rather than pinned over it. Pinned,
// it sat on top of the last rows and took a strip of the window on every
// screen of a report most people read from the top. Here it is where a
// printed report puts it, after the last account, and inside the same
// scrollport, so it moves sideways with the columns it lines up with.
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
        <div
          role="cell"
          aria-colspan={cols.length}
          className="px-inset py-2 text-xs font-semibold uppercase tracking-wide"
        >
          {t(`section.${section.key}`)}
        </div>
      </div>

      {section.accounts.map((a) => {
        const key = `${group.costCenterCode ?? ""}|${a.account}`;
        const open = openKey === key;
        const value = rowValue(a, isBalance);
        return (
          <Fragment key={key}>
            {/* The expander is a real button on the account name, not a click
                handler on the row. A `role="row"` with an onClick is reachable
                by mouse alone: no tab stop, no Enter, and `aria-expanded` on a
                row announces a state nothing can be operated to change. The row
                keeps its hover, driven from the button's own focus too, so
                nothing looks different and it can now be used. */}
            <div
              role="row"
              className={cn(
                ROW,
                "group border-t border-border hover:bg-hover focus-within:bg-surface",
                open && "bg-surface",
              )}
            >
              <div role="cell" className="min-w-0 py-2 pl-inset pr-3">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onToggle(group, a)}
                  className="cursor-pointer text-left"
                >
                  <span className="font-medium tabular-nums">{a.account}</span>{" "}
                  <span className="text-muted">{a.accountName}</span>
                </button>
              </div>
              {/* The figures in the columns' own order, so a row always lines up
                  with the heading above it whatever the reader picked. */}
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

// The voucher rows behind one account, fetched on first expand. A real table:
// it is its own little grid of columns, unrelated to the report's.
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
            <td className="py-1 pr-3 whitespace-nowrap font-medium text-foreground">
              {r.voucher}
            </td>
            <td className="py-1 pr-3">{r.text || r.description}</td>
            {showCostCenter && (
              <td className="py-1 pr-3 whitespace-nowrap">{r.costCenter ?? "–"}</td>
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
