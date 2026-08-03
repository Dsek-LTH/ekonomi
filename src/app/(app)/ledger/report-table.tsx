"use client";

// The report's grid: one cost-centre group per card, the voucher rows behind
// any account one click away, and the bottom line under it all.
//
// Laid out on CSS grid rather than as tables, and — the part that matters — the
// group cards share ONE sideways scrollport instead of having one each. Column
// widths were never the hard part; two scroll containers were. Identically
// sized columns in two scrollports are aligned exactly until you scroll one of
// them, which is why the earlier per-card version needed JavaScript to keep
// fifty of them in step on every scroll event. With a single scrollport the
// alignment is structural and there is nothing to synchronise.
//
// The bottom line is the one exception: it is pinned to the viewport, so it
// cannot live inside the scrollport (`overflow-x: auto` computes `overflow-y`
// to `auto` too, and a sticky child would then stick to a container that never
// scrolls vertically instead of to the screen). It gets its own scrollport and
// is the single element still kept in step — one write per scroll event.
import { Fragment, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { formatPercent, resultTone, rowValue, share, totalValue } from "./report-view";
import type {
  GroupMode,
  LedgerReport,
  ReportAccount,
  ReportGroup,
  ReportSection,
  RowView,
  ViewOptions,
} from "./report-types";

export interface Shape {
  isBalance: boolean;
  showComparison: boolean;
  comparisonLabel: string;
  share: boolean;
  diff: boolean; // the difference column beside the comparison
}

// One description of the columns for the whole report. It becomes grid tracks
// on a custom property that every grid in the report reads, so a cost centre's
// rows, the next cost centre's and the bottom line are laid out by the same
// declaration rather than by three that have to agree.
interface ColumnSpec {
  key: "account" | "opening" | "amount" | "closing" | "share" | "comparison" | "diff";
  /** A key under `ledger.col`, except `comparison`, whose heading names the
   *  thing being compared against and is built by the client. */
  label: string;
  width: number | null; // rem; null = takes the remaining width
}

const ACCOUNT_MIN = 14; // rem — the floor the account column shrinks to

export function reportColumns(shape: Shape, showShare: boolean): ColumnSpec[] {
  const cols: ColumnSpec[] = [{ key: "account", label: "account", width: null }];
  if (shape.isBalance) cols.push({ key: "opening", label: "opening", width: 9 });
  cols.push({ key: "amount", label: shape.isBalance ? "period" : "amount", width: 9 });
  if (shape.isBalance) cols.push({ key: "closing", label: "closing", width: 9 });
  if (showShare) cols.push({ key: "share", label: "share", width: 6 });
  if (shape.showComparison) {
    // Already worded by the client — see `comparisonLabel` on Shape.
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

// The sideways scrollport. On paper nothing scrolls and nothing has a minimum
// width — the page is as wide as it is.
export function ReportScroller({
  register,
  className,
  children,
}: {
  register: (el: HTMLDivElement | null) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={register}
      className={cn(
        "overflow-x-auto overscroll-x-contain print:overflow-visible",
        className,
      )}
    >
      <div className="min-w-[var(--report-min-w)] print:min-w-0">{children}</div>
    </div>
  );
}

// The group cards and the pinned bottom line scroll as one. Two elements, one
// write each way, and an echo is recognised by the offset already matching
// rather than by a timer.
export function useColumnScrollSync() {
  const ref = useRef<{ ports: Set<HTMLDivElement>; offset: number }>({
    ports: new Set(),
    offset: 0,
  });

  return useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const state = ref.current;
    state.ports.add(el);
    el.scrollLeft = state.offset;

    const onScroll = () => {
      if (el.scrollLeft === state.offset) return; // our own write coming back
      state.offset = el.scrollLeft;
      for (const other of state.ports) {
        if (other !== el && other.scrollLeft !== state.offset) {
          other.scrollLeft = state.offset;
        }
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      state.ports.delete(el);
    };
  }, []);
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

// Every totalling row in the report — a section's sum, a cost centre's heading,
// the bottom line — is the same row with a different label and weight. One
// renderer, so they cannot end up disagreeing about which column a figure
// belongs under.
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
  value: { total: number; opening: number | null; closing: number | null; comparison: number | null };
  /** Colour the result figure green or red — only where the sign is the news. */
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
        if (c.key === "share") {
          return <div key={c.key} role="cell" className={cn(AMOUNT_CELL, cellClassName)} />;
        }
        if (c.key === "diff") {
          return (
            <div key={c.key} role="cell" className={cn(AMOUNT_CELL, cellClassName)}>
              <Diff value={result} against={value.comparison} />
            </div>
          );
        }
        const amount =
          c.key === "opening"
            ? value.opening ?? 0
            : c.key === "closing"
              ? value.closing ?? 0
              : c.key === "comparison"
                ? value.comparison
                : value.total;
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

export function ReportGroupCard({
  group,
  groupMode,
  shape,
  view,
  openKey,
  rows,
  onToggle,
}: {
  group: ReportGroup;
  groupMode: GroupMode;
  shape: Shape;
  view: ViewOptions;
  openKey: string | null;
  rows: Record<string, RowView[]>;
  onToggle: (group: ReportGroup, account: ReportAccount) => void;
}) {
  const t = useTranslations("ledger");
  const cols = reportColumns(shape, view.share);

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
                  ? `${group.costCenterCode} · ${group.costCenterName ?? ""}`
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
            view={view}
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

// The bottom line, on the same tracks as the cards above it, so each total sits
// under the column it totals — the outcome under Belopp, the budget under
// Budget. Pinned, so it has its own scrollport (see the note at the top).
export function ReportTotalBar({
  report,
  shape,
  view,
  label,
  register,
}: {
  report: LedgerReport;
  shape: Shape;
  view: ViewOptions;
  label: string;
  register: (el: HTMLDivElement | null) => void;
}) {
  const cols = reportColumns(shape, view.share);
  return (
    <Card
      className={cn(
        "sticky bottom-0 z-10 overflow-hidden",
        "print:static print:overflow-visible print:shadow-none",
      )}
    >
      <ReportScroller register={register}>
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
      </ReportScroller>
    </Card>
  );
}

function SectionRows({
  section,
  group,
  groupMode,
  shape,
  view,
  cols,
  openKey,
  rows,
  onToggle,
}: {
  section: ReportSection;
  group: ReportGroup;
  groupMode: GroupMode;
  shape: Shape;
  view: ViewOptions;
  cols: ColumnSpec[];
  openKey: string | null;
  rows: Record<string, RowView[]>;
  onToggle: (group: ReportGroup, account: ReportAccount) => void;
}) {
  const t = useTranslations("ledger");
  const { isBalance, showComparison } = shape;
  const showDiff = showComparison && shape.diff;
  const sectionValue = totalValue(section, isBalance);

  return (
    <Fragment>
      <div role="row" className="col-span-full border-t border-border bg-surface/40">
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
            <div
              role="row"
              aria-expanded={open}
              onClick={() => onToggle(group, a)}
              className={cn(
                ROW,
                "cursor-pointer border-t border-border hover:bg-surface/50",
                open && "bg-surface/40",
              )}
            >
              <div role="cell" className="min-w-0 py-2 pl-inset pr-3">
                <span className="font-medium tabular-nums">{a.account}</span>{" "}
                <span className="text-muted">{a.accountName}</span>
              </div>
              {isBalance && (
                <div role="cell" className={cn(AMOUNT_CELL, "text-muted")}>
                  {formatSEK(a.opening ?? 0)}
                </div>
              )}
              <div
                role="cell"
                className={cn(AMOUNT_CELL, isBalance ? "text-muted" : "font-medium")}
              >
                {formatSEK(a.amount)}
              </div>
              {isBalance && (
                <div role="cell" className={cn(AMOUNT_CELL, "font-medium")}>
                  {formatSEK(a.closing ?? 0)}
                </div>
              )}
              {view.share && (
                <div role="cell" className={cn(AMOUNT_CELL, "text-muted")}>
                  {formatPercent(share(value, sectionValue))}
                </div>
              )}
              {showComparison && (
                <div role="cell" className={cn(AMOUNT_CELL, "text-muted")}>
                  {a.comparison == null ? "" : formatSEK(a.comparison)}
                </div>
              )}
              {showDiff && (
                <div role="cell" className={AMOUNT_CELL}>
                  <Diff value={value} against={a.comparison} />
                </div>
              )}
            </div>

            {open && (
              <div role="row" className="col-span-full border-t border-border bg-surface/30">
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
              <td className="py-1 pr-3 whitespace-nowrap">{r.costCenter ?? "—"}</td>
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
