"use client";

// The day's sold lines: what the intäktsräkning beside it is a rendering of,
// and so what the reviewer compares it with.
//
// Three levels, each drawn so it reads as one: a block per verksamhet (with
// the sales routing could not place in a block of their own first, and
// Zettle's fees last), an account heading inside it with a bar down the left
// edge that runs through its lines, and the products under that, grouped the
// way the document groups them (lib/income/sold-lines.ts).
//
// Each block is a card of its own, with its column headings under its band,
// and every block uses the same fixed columns, so they still line up column
// for column across the gaps.
//
// Where the money books is set at the level it is decided:
//
//   - the cost centre for a whole verksamhet's day, in its heading's
//     Kostnadsställe cell. Every line shows its own as well, and one that
//     differs from the heading's is tagged, so the exceptions stand out;
//   - the account for a whole account group, in that group's heading. There
//     is no account column on the lines, since every line under a heading has
//     that heading's account; a few lines are re-accounted from the bar that
//     appears when lines are picked, next to "Ge till verksamhet".
//
// Every value is text until clicked, then the picker, then text again, so no
// row is a control's height taller than the rest.
import { createContext, useContext, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { IconChevronDown, IconElbow } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import type { IncomeLineRow } from "@/lib/data/income";
import { productDisplayName } from "@/lib/income/product-groups";
import { daySections, type DaySection } from "@/lib/income/sold-lines";
import { formatNumber } from "@/lib/ui/format";
import { cn } from "@/lib/ui/utils";

type Translator = (key: string, values?: Record<string, string | number>) => string;
type Section = DaySection<IncomeLineRow>;
type AccountGroup = Section["accounts"][number];

const figure = (kr: number) => formatNumber(kr, 2, 2);

/**
 * A day already konterad: the same table, nothing in it to pick or change.
 * A context rather than a prop through every row, since every control in the
 * table asks the same question.
 */
const ReadOnly = createContext(false);

/** Which value is a picker right now. One at a time, closed however it ends. */
type Editing =
  | { kind: "lineCostCenter"; id: string }
  | { kind: "blockCostCenter"; id: string }
  | { kind: "groupAccount"; id: string }
  | null;

/**
 * The block's cost centre: the one most of its money-moving lines carry, and
 * whether every one of them does. The heading shows it; a line that differs
 * from it is tagged.
 */
function blockCostCenter(lines: readonly IncomeLineRow[]): { code: string | null; mixed: boolean } {
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (l.total === 0) continue;
    const code = l.costCenterCode ?? "";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  if (counts.size === 0) return { code: null, mixed: false };
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { code: top[0] || null, mixed: counts.size > 1 };
}

/** Every line of an account group, the prefix rows' included. */
const groupLines = (group: AccountGroup): IncomeLineRow[] =>
  group.rows.flatMap((r) => (r.kind === "line" ? [r.line] : r.kind === "prefix" ? r.lines : []));

/** The fixed columns every block shares, so they line up across the gaps. */
function Columns({ discounts }: { discounts: boolean }) {
  return (
    <colgroup>
      <col className="w-9" />
      <col />
      <col className="w-28" />
      <col className="w-14" />
      <col className="w-24" />
      {discounts && <col className="w-24" />}
      <col className="w-28" />
    </colgroup>
  );
}

export function SoldLinesTable({
  lines,
  picked,
  onPick,
  onAssign,
  accountOptionsFor,
  costCenterOptions,
  ownCostCenters,
  inactiveCodes,
  onAccount,
  onCostCenter,
  busy,
  readOnly = false,
  t,
}: {
  lines: IncomeLineRow[];
  /** A konterad day: the lines are shown, not worked. */
  readOnly?: boolean;
  picked: string[];
  onPick: (lineIds: string[]) => void;
  /** Open "give to verksamhet" for these lines. */
  onAssign: (lineIds: string[]) => void;
  /** The account picker's options for a line: its verksamhet's own first. */
  accountOptionsFor: (line: IncomeLineRow) => ComboOption[];
  costCenterOptions: ComboOption[];
  /** A verksamhet's own cost centres, offered first in its heading's picker. */
  ownCostCenters: (resultUnitId: string | null) => string[];
  /** Codes of archived cost centres, drawn as a warning where a line has one. */
  inactiveCodes: string[];
  /** Book these lines to this account. */
  onAccount: (lineIds: string[], account: string) => void;
  /** Book these lines to this cost centre. */
  onCostCenter: (lineIds: string[], code: string) => void;
  busy: boolean;
  t: Translator;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const sections = daySections(lines);
  const discounts = lines.some((l) => l.discount !== 0);
  const columns = 6 + (discounts ? 1 : 0);
  const sales = lines.filter((l) => l.kind === "SALE");
  const pickedLines = lines.filter((l) => picked.includes(l.id));

  const togglePick = (ids: string[], on: boolean) =>
    onPick(on ? [...new Set([...picked, ...ids])] : picked.filter((id) => !ids.includes(id)));

  /** The verksamhet's own cost centres first, then every other one. */
  const blockOptions = (resultUnitId: string | null): ComboOption[] => {
    const own = new Set(ownCostCenters(resultUnitId));
    return [
      ...costCenterOptions.filter((o) => own.has(o.value)),
      ...costCenterOptions.filter((o) => !own.has(o.value)),
    ];
  };

  const blockTitle = (section: Section) =>
    section.kind === "unmatched"
      ? t("lines.unmatchedSection")
      : section.kind === "fees"
        ? t("lines.feesSection")
        : (section.title ?? "-");

  const shared = { editing, setEditing, picked, togglePick, onAssign, inactiveCodes, busy, t };

  /** The column headings, under each block's band rather than once above them all. */
  const headings = (
    <tr className="text-xs text-muted [&>th]:border-b [&>th]:border-border [&>th]:py-1.5 [&>th]:font-medium">
      <th />
      <th className="px-3 text-left">{t("lines.product")}</th>
      <th className="px-3 text-left">{t("lines.costCenter")}</th>
      <th className="px-3 text-right">{t("lines.quantity")}</th>
      <th className="whitespace-nowrap px-3 text-right">{t("lines.unitPriceKr")}</th>
      {discounts && <th className="whitespace-nowrap px-3 text-right">{t("lines.discountKr")}</th>}
      <th className="whitespace-nowrap px-3 text-right">{t("lines.totalKr")}</th>
    </tr>
  );

  return (
    <ReadOnly.Provider value={readOnly}>
      <section aria-label={t("review.lines")} className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-sm font-semibold">{t("review.lines")}</h2>
          {/* Every sale on the day at once, which used to sit in the one heading
            row above all the blocks. */}
          {sales.length > 0 && !readOnly && (
            <Checkbox
              checked={picked.length > 0 && picked.length === sales.length}
              indeterminate={picked.length > 0 && picked.length < sales.length}
              onChange={() => onPick(picked.length === sales.length ? [] : sales.map((l) => l.id))}
              label={t("move.selectAll")}
            >
              <span className="text-xs text-muted">{t("move.selectAll")}</span>
            </Checkbox>
          )}
        </div>
        <div className="space-y-3">
          {sections.map((section) => {
            const cc = blockCostCenter(section.lines);
            const ids = section.lines.filter((l) => l.kind === "SALE").map((l) => l.id);
            const allPicked = ids.length > 0 && ids.every((id) => picked.includes(id));
            return (
              // A card per verksamhet, and the only card: the blocks stand on
              // the page beside the other cards of the day rather than inside
              // one more. Scrolls sideways on its own when the column is
              // narrow.
              <div
                key={section.key}
                className={cn(
                  "overflow-x-auto rounded-panel border bg-background",
                  section.kind === "unmatched" ? "border-warning/40" : "border-border",
                )}
              >
                <table className="w-full min-w-[34rem] table-fixed text-sm">
                  <Columns discounts={discounts} />
                  <thead>
                    {/* The verksamhet: its name, its cost centre for the day, and
                        what its sales came to. One section of the document. */}
                    <tr
                      className={cn(
                        "[&>td]:py-2",
                        section.kind === "unmatched" ? "bg-warning-soft" : "bg-surface",
                      )}
                    >
                      <td className="pl-3">
                        {section.kind !== "fees" && ids.length > 0 && !readOnly && (
                          <Checkbox
                            checked={allPicked}
                            indeterminate={!allPicked && ids.some((id) => picked.includes(id))}
                            onChange={() => togglePick(ids, !allPicked)}
                            label={t("lines.selectBlock", { unit: blockTitle(section) })}
                          />
                        )}
                      </td>
                      <td className="px-3">
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          {blockTitle(section)}
                        </span>
                        {section.kind === "unmatched" && (
                          <span className="ml-2 text-xs text-muted">
                            {t("lines.unmatchedHint")}
                          </span>
                        )}
                      </td>
                      <td className="px-3">
                        {section.kind !== "unmatched" && (
                          <ValuePicker
                            open={editing?.kind === "blockCostCenter" && editing.id === section.key}
                            onOpen={() => setEditing({ kind: "blockCostCenter", id: section.key })}
                            onClose={() => setEditing(null)}
                            options={blockOptions(section.resultUnitId)}
                            value={cc.mixed ? "" : (cc.code ?? "")}
                            onPick={(v) =>
                              onCostCenter(
                                section.lines.map((l) => l.id),
                                v,
                              )
                            }
                            label={t("lines.sectionCostCenter", { unit: blockTitle(section) })}
                            busy={busy}
                            strong
                          >
                            {cc.mixed ? (
                              <Tag tone="warning">{t("lines.mixedCostCenters")}</Tag>
                            ) : cc.code ? (
                              <span className="tnum">{cc.code}</span>
                            ) : (
                              <Tag tone="warning">{t("lines.noCostCenter")}</Tag>
                            )}
                          </ValuePicker>
                        )}
                      </td>
                      <td colSpan={columns - 4} />
                      <td className="tnum px-3 text-right font-semibold">
                        {figure(section.total)}
                      </td>
                    </tr>
                    {headings}
                  </thead>
                  <tbody>
                    {section.accounts.map((group, i) => (
                      <GroupRows
                        key={`${section.key}:${group.account}`}
                        sectionKey={section.key}
                        group={group}
                        first={i === 0}
                        blockCode={section.kind === "unmatched" ? undefined : cc.code}
                        columns={columns}
                        discounts={discounts}
                        accountOptions={(() => {
                          const sample = groupLines(group)[0];
                          return sample ? accountOptionsFor(sample) : [];
                        })()}
                        costCenterOptions={blockOptions(section.resultUnitId)}
                        onAccount={onAccount}
                        onCostCenter={onCostCenter}
                        {...shared}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        {/* Only once something is picked: an action bar on a day nobody is
          correcting is a row of controls to read past. Its own card, sticky
          at the bottom of the day's column from xl, so it stays in reach while
          the lines it acts on are scrolled through. */}
        {picked.length > 0 && !readOnly && (
          <Card className="xl:sticky xl:bottom-0 xl:z-10 xl:shadow-sm">
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted">
                {t("move.picked", { count: picked.length })}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-40">
                  <Combobox
                    size="sm"
                    options={pickedLines[0] ? accountOptionsFor(pickedLines[0]) : []}
                    value=""
                    onChange={(v) => v && onAccount(picked, v)}
                    placeholder={t("lines.setAccount")}
                    disabled={busy}
                    aria-label={t("lines.setAccount")}
                  />
                </div>
                <div className="w-44">
                  <Combobox
                    size="sm"
                    options={blockOptions(pickedLines[0]?.resultUnitId ?? null)}
                    value=""
                    onChange={(v) => v && onCostCenter(picked, v)}
                    placeholder={t("lines.setCostCenter")}
                    disabled={busy}
                    aria-label={t("lines.setCostCenter")}
                  />
                </div>
                <Button size="sm" onClick={() => onAssign(picked)} disabled={busy}>
                  {t("move.action")}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </section>
    </ReadOnly.Provider>
  );
}

/**
 * A value that is text until clicked, then a picker. The same height either
 * way, which is the point: a heading row with a bordered input in it was a
 * row taller than the rest, in a style nothing else in the table had.
 */
function ValuePicker({
  open,
  onOpen,
  onClose,
  options,
  value,
  onPick,
  label,
  busy,
  strong,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  options: ComboOption[];
  value: string;
  onPick: (value: string) => void;
  label: string;
  busy: boolean;
  /** A heading's value: semibold, with the chevron always showing. */
  strong?: boolean;
  children: React.ReactNode;
}) {
  const readOnly = useContext(ReadOnly);
  if (readOnly) {
    return (
      <span
        className={cn(
          "inline-flex h-6 max-w-full items-center truncate",
          strong && "font-semibold",
        )}
      >
        {children}
      </span>
    );
  }
  if (open) {
    return (
      <Combobox
        size="sm"
        options={options}
        value={value}
        openOnMount
        autoFocus
        onClose={onClose}
        // The text button's own box, not a form field's: the field is 32px
        // and this row is not, so the row grew while the picker was open and
        // shrank back when it closed. The search is laid over the trigger at
        // the trigger's height, so it fits the same box.
        buttonClassName={cn(
          "-mx-1.5 h-6 rounded-control bg-hover px-1.5",
          strong && "font-semibold",
        )}
        onChange={(v) => {
          onClose();
          if (v && v !== value) onPick(v);
        }}
        disabled={busy}
        aria-label={label}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onOpen}
      title={label}
      aria-label={label}
      className={cn(
        "group/value -mx-1.5 inline-flex h-6 max-w-full items-center gap-1 rounded-control px-1.5 text-left hover:bg-hover disabled:opacity-60",
        strong && "font-semibold",
      )}
    >
      <span className="truncate">{children}</span>
      <IconChevronDown
        className={cn(
          "size-3 shrink-0 text-faint",
          !strong && "opacity-0 group-hover/value:opacity-100",
        )}
      />
    </button>
  );
}

/**
 * One account group: its heading, then its products. The bar down the left
 * edge, drawn as an inset shadow on the first cell of every row in the group,
 * is what ties the lines to the heading above them.
 */
function GroupRows({
  sectionKey,
  group,
  first,
  blockCode,
  columns,
  discounts,
  accountOptions,
  costCenterOptions,
  onAccount,
  onCostCenter,
  editing,
  setEditing,
  picked,
  togglePick,
  onAssign,
  inactiveCodes,
  busy,
  t,
}: {
  sectionKey: string;
  group: AccountGroup;
  first: boolean;
  /**
   * The block's cost centre, which a line is compared with. Undefined on the
   * unmatched block, which belongs to nobody, so every line shows its own.
   */
  blockCode: string | null | undefined;
  columns: number;
  discounts: boolean;
  accountOptions: ComboOption[];
  costCenterOptions: ComboOption[];
  onAccount: (lineIds: string[], account: string) => void;
  onCostCenter: (lineIds: string[], code: string) => void;
  editing: Editing;
  setEditing: (e: Editing) => void;
  picked: string[];
  togglePick: (ids: string[], on: boolean) => void;
  onAssign: (lineIds: string[]) => void;
  inactiveCodes: string[];
  busy: boolean;
  t: Translator;
}) {
  const readOnly = useContext(ReadOnly);
  const bar = "shadow-[inset_3px_0_0_var(--color-grid-line)]";
  const groupKey = `${sectionKey}:${group.account}`;
  const all = groupLines(group);

  return (
    <>
      {/* The account and what the group comes to: one of the voucher's rows,
          and one of the document's distribution rows, in the same figure. */}
      <tr
        className={cn(
          "bg-canvas/60 [&>td]:py-1.5",
          !first && "[&>td]:border-t [&>td]:border-border",
        )}
      >
        <td className={bar} />
        <td className="px-3" colSpan={2}>
          <ValuePicker
            open={editing?.kind === "groupAccount" && editing.id === groupKey}
            onOpen={() => setEditing({ kind: "groupAccount", id: groupKey })}
            onClose={() => setEditing(null)}
            options={accountOptions}
            value={group.account}
            onPick={(v) =>
              onAccount(
                all.map((l) => l.id),
                v,
              )
            }
            label={t("lines.groupAccount", { account: group.account || t("lines.noAccount") })}
            busy={busy}
          >
            <span className="tnum font-medium text-foreground">
              {group.account || t("lines.noAccount")}
            </span>
            {group.accountName && <span className="text-muted"> - {group.accountName}</span>}
          </ValuePicker>
        </td>
        <td colSpan={columns - 4} />
        <td className="tnum px-3 text-right font-medium">{figure(group.total)}</td>
      </tr>

      {group.rows.map((row) => {
        const key = `${groupKey}:${row.key}`;
        const lineRow = "[&>td]:border-t [&>td]:border-border/50";

        if (row.kind === "group") {
          return (
            <tr key={key} className={lineRow}>
              <td className={bar} />
              <td colSpan={columns - 1} className="px-3 pb-0.5 pt-1.5 font-medium">
                {row.name}
              </td>
            </tr>
          );
        }

        if (row.kind === "prefix") {
          const ids = row.lines.map((l) => l.id);
          const allPicked = ids.every((id) => picked.includes(id));
          return (
            // A prefix nobody owns, and every line rung up with it. Said as
            // the reason the lines are here, and given away as one.
            <tr key={key} className={lineRow}>
              <td className={cn(bar, "pl-3 py-1.5")}>
                {!readOnly && (
                  <Checkbox
                    checked={allPicked}
                    indeterminate={!allPicked && ids.some((id) => picked.includes(id))}
                    onChange={() => togglePick(ids, !allPicked)}
                    label={t("lines.selectPrefix", { prefix: row.prefix })}
                  />
                )}
              </td>
              <td colSpan={columns - 1} className="px-3 py-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="rounded-control border border-warning/30 bg-warning-soft px-1.5 font-mono text-xs font-semibold text-warning">
                    {row.prefix}
                  </span>
                  <span className="text-xs text-muted">
                    {t("lines.unknownPrefix", { count: row.lines.length })}
                  </span>
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => onAssign(ids)}
                    >
                      {t("lines.movePrefix", { prefix: row.prefix, count: row.lines.length })}
                    </Button>
                  )}
                </span>
              </td>
            </tr>
          );
        }

        const line = row.line;
        const name = productDisplayName(line);
        const isFee = line.kind === "FEE";
        const code = line.costCenterCode;
        // Tagged when it says something the heading does not: a different cost
        // centre. On the unmatched block there is no heading to differ from.
        const differs = blockCode !== undefined && code !== blockCode;
        const inactive = Boolean(code && inactiveCodes.includes(code));
        return (
          <tr key={key} className={cn(lineRow, "[&>td]:align-middle")}>
            <td className={cn(bar, "py-1 pl-3")}>
              {!isFee && !readOnly && (
                <Checkbox
                  checked={picked.includes(line.id)}
                  onChange={() => togglePick([line.id], !picked.includes(line.id))}
                  label={t("move.selectLine", { product: name })}
                />
              )}
            </td>
            <td className="truncate px-3 py-1">
              <span className={cn("flex min-w-0 items-center gap-1.5", row.indented && "pl-4")}>
                {row.indented && <IconElbow className="size-3.5 shrink-0 text-faint opacity-60" />}
                <span className="truncate">{row.label}</span>
                {line.unmatched && line.unitName && (
                  <span className="shrink-0 text-xs text-muted">({line.unitName})</span>
                )}
              </span>
            </td>
            <td className="px-3 py-1">
              <ValuePicker
                open={editing?.kind === "lineCostCenter" && editing.id === line.id}
                onOpen={() => setEditing({ kind: "lineCostCenter", id: line.id })}
                onClose={() => setEditing(null)}
                options={costCenterOptions}
                value={code ?? ""}
                onPick={(v) => onCostCenter([line.id], v)}
                label={t("lines.costCenterFor", { product: name })}
                busy={busy}
              >
                {!code ? (
                  <Tag tone="warning">{t("lines.noCostCenter")}</Tag>
                ) : inactive ? (
                  <Tag tone="warning">{code}</Tag>
                ) : differs ? (
                  <Tag tone="blue">{code}</Tag>
                ) : (
                  <span className="tnum">{code}</span>
                )}
              </ValuePicker>
            </td>
            <td className="tnum px-3 py-1 text-right">{line.quantity}</td>
            <td className="tnum px-3 py-1 text-right">{figure(line.unitPrice)}</td>
            {discounts && (
              <td className="tnum px-3 py-1 text-right text-muted">
                {line.discount ? figure(line.discount) : ""}
              </td>
            )}
            <td className="tnum px-3 py-1 text-right font-medium">{figure(line.total)}</td>
          </tr>
        );
      })}
    </>
  );
}
