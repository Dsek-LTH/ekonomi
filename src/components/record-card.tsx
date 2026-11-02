"use client";

// The parts a record's card is built from, shared by the two pages laid out as
// a document: an utlägg (expenses/[id]) and a levfaktura (invoices/[id]). The
// fact strip, the ruled sections, the cost distribution and the voucher read
// the same on both, so they are drawn by the same code.
import { useTranslations } from "next-intl";
import { Amount } from "@/components/ui/amount";
import { IconCheck } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";

/** The small capitals every label and column head on the card is set in. */
export const LABEL = "text-xs font-medium text-muted";

/**
 * One part of the card below the strip, ruled off from the part above.
 *
 * `flush` drops the side padding for a table that runs to the card's edges and
 * carries the inset on its own first and last cells, so its columns still line
 * up with the text of every other section.
 */
export function InspectorSection({
  title,
  aside,
  action,
  flush = false,
  endsInTable = false,
  children,
}: {
  title?: string;
  /** Beside the title, in body text: the voucher's number and date. */
  aside?: React.ReactNode;
  action?: React.ReactNode;
  flush?: boolean;
  /** The last row of a table carries 8px of padding of its own, so the
   *  section keeps only 8px under it, to match the 16px above the heading. */
  endsInTable?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("border-t border-border pt-4", endsInTable ? "pb-2" : "pb-4")}>
      {(title || action) && (
        <div className="mb-2 flex min-h-6 items-center justify-between gap-3 px-inset">
          <h2 className="flex min-w-0 items-baseline gap-3">
            <span className={LABEL}>{title}</span>
            {aside && <span className="truncate text-sm">{aside}</span>}
          </h2>
          {action}
        </div>
      )}
      <div className={cn(!flush && "px-inset")}>{children}</div>
    </section>
  );
}

/**
 * One cell of the fact strip: a label in small capitals, the value under it.
 * `truncate` for a value that is plain text and may run long (a unit's name).
 */
export function StripCell({
  label,
  className,
  truncate = false,
  children,
}: {
  label: string;
  className?: string;
  truncate?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 bg-background px-inset py-3", className)}>
      <p className={LABEL}>{label}</p>
      <div className={cn("mt-1 min-w-0 text-sm", truncate && "truncate")}>{children}</div>
    </div>
  );
}

/** Signed by this person, in the attest column. */
export function AttestedBy({ name }: { name?: string | null }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-success">
      <IconCheck className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export interface AllocationLine {
  id: string;
  costCenterCode: string;
  costCenterName: string;
  comment?: string | null;
  /** In kronor. `null` while the share is not yet known. */
  amount: number | null;
  /** Who attested it, or whose it still is to attest. */
  attest: React.ReactNode;
}

/**
 * The cost distribution as an invoice's line items: cost centre, amount, who
 * attested it, and the sum as the last line.
 *
 * The column heads are the section's title, the way they are on paper. The
 * total is added up from the rows rather than copied from the record, so a
 * split that does not match the amount above is visible as two numbers that
 * disagree.
 *
 * On a phone the attest column is dropped and its content moves under the
 * cost centre's name. Three columns on 329px of card left the name about
 * 110px, which for a Swedish compound is the first syllable and an ellipsis.
 * The amount stays in its own column at every width, since it is the one
 * thing here that must never be cut.
 */
export function AllocationTable({ caption, lines }: { caption: string; lines: AllocationLine[] }) {
  const t = useTranslations("common.allocation");
  const total = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);

  return (
    // pb-2, not pb-4: the last row carries 8px of its own padding, and the
    // two together left more room under the table than above it.
    <section className="border-t border-border px-inset pb-2 pt-4">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left">
            <th className={cn(LABEL, "pb-2 pr-3")}>{t("costCenter")}</th>
            <th className={cn(LABEL, "w-32 pb-2 text-right")}>{t("amount")}</th>
            <th className={cn(LABEL, "hidden w-[38%] pb-2 pl-6 sm:table-cell")}>{t("attest")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-border align-top">
              <td className="py-2 pr-3">
                <div className="truncate">
                  <span className="font-medium tabular-nums">{l.costCenterCode}</span>
                  <span className="ml-2 text-muted">{l.costCenterName}</span>
                </div>
                <div className="mt-0.5 truncate text-xs sm:hidden">{l.attest}</div>
                {l.comment && <p className="mt-1 text-xs italic text-muted">{l.comment}</p>}
              </td>
              <td className="whitespace-nowrap py-2 text-right tabular-nums">
                {l.amount == null ? (
                  <span className="text-muted">-</span>
                ) : (
                  <Amount value={l.amount} signed />
                )}
              </td>
              <td className="hidden truncate py-2 pl-6 text-xs leading-5 sm:table-cell">
                {l.attest}
              </td>
            </tr>
          ))}
        </tbody>
        {lines.length > 1 && (
          <tfoot>
            {/* The same hairline as between the rows, so the total reads as
                the last line of the list, set apart by its weight alone. */}
            <tr className="border-t border-border font-semibold">
              <td className="py-2 pr-3">{t("total")}</td>
              <td className="whitespace-nowrap py-2 text-right tabular-nums">
                <Amount value={total} signed />
              </td>
              <td className="hidden sm:table-cell" />
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
}

export interface VoucherLine {
  key: string;
  account: string;
  accountName: string;
  costCenter?: string | null;
  project?: string | null;
  /** The line's own text, when it says something the voucher's does not. */
  note?: string;
  /** In kronor. A line is a debit or a credit, so one of the two is 0. */
  debit: number;
  credit: number;
}

/**
 * A voucher's lines, laid out the way a ledger prints them, a column per
 * thing: account number, account name, cost centre, debit, credit.
 *
 * From sm, a column each for debit and credit. Below it the two become one
 * amount with the side written beside it: a line of a double entry is a debit
 * *or* a credit, never both, so nothing is dropped. The cost centre moves
 * under the account name on a phone for the same reason the allocation
 * table's attest does: a fifth column on 329px leaves the name nothing.
 *
 * Hidden with `hidden`/`sm:table-cell` on both the head and the body, so every
 * row shows the same set and the columns stay in step. The project column only
 * when a line has one: most vouchers carry none, and an empty column would
 * take the name's room for nothing.
 */
export function VoucherTable({ lines }: { lines: VoucherLine[] }) {
  const t = useTranslations("common.voucher");
  const hasProject = lines.some((l) => l.project);

  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left">
          <th className={cn(LABEL, "w-16 pb-2 pl-inset")}>{t("account")}</th>
          <th className={cn(LABEL, "pb-2 pl-3")}>{t("accountName")}</th>
          <th className={cn(LABEL, "hidden w-20 pb-2 pl-3 sm:table-cell")}>
            {t("costCenterShort")}
          </th>
          {hasProject && (
            <th className={cn(LABEL, "hidden w-16 pb-2 pl-3 sm:table-cell")}>
              {t("projectShort")}
            </th>
          )}
          <th className={cn(LABEL, "w-28 pb-2 pl-3 pr-inset text-right sm:hidden")}>
            {t("amount")}
          </th>
          <th className={cn(LABEL, "hidden w-28 pb-2 pl-3 text-right sm:table-cell")}>
            {t("debit")}
          </th>
          <th className={cn(LABEL, "hidden w-28 pb-2 pl-3 pr-inset text-right sm:table-cell")}>
            {t("credit")}
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} className="border-t border-border align-top">
            <td className="py-2 pl-inset font-medium tabular-nums">{l.account}</td>
            <td className="py-2 pl-3">
              <span className="block truncate">{l.accountName}</span>
              {l.costCenter && (
                <span className="block text-xs text-muted sm:hidden">{l.costCenter}</span>
              )}
              {l.project && (
                <span className="block text-xs text-muted sm:hidden">
                  {t("projectShort")} {l.project}
                </span>
              )}
              {l.note && <span className="block truncate text-xs text-muted">{l.note}</span>}
            </td>
            <td className="hidden py-2 pl-3 tabular-nums text-muted sm:table-cell">
              {l.costCenter}
            </td>
            {hasProject && (
              <td className="hidden py-2 pl-3 tabular-nums text-muted sm:table-cell">
                {l.project}
              </td>
            )}
            <td className="whitespace-nowrap py-2 pl-3 pr-inset text-right tabular-nums sm:hidden">
              <Amount value={l.debit || l.credit} />
              <span className="ml-1.5 text-xs text-muted">
                {l.debit ? t("debitShort") : t("creditShort")}
              </span>
            </td>
            <td className="hidden whitespace-nowrap py-2 pl-3 text-right tabular-nums sm:table-cell">
              {l.debit ? <Amount value={l.debit} /> : null}
            </td>
            <td className="hidden whitespace-nowrap py-2 pl-3 pr-inset text-right tabular-nums sm:table-cell">
              {l.credit ? <Amount value={l.credit} /> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
