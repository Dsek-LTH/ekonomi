"use client";

// The gear on an uthyrningsavtal, as the lines of an invoice.
//
// Shaped like one on purpose. This is the part of the form that decides what
// somebody is charged, and the arrangement everybody already knows for that is
// a row per thing with the amount worked out at the end of it: description,
// quantity, unit price, discount, amount. A renter reading the drawn contract
// sees the same five columns in the same order, so the form and the document
// are one thing seen twice rather than two.
//
// No VAT column. The section is momsbefriad, so a line for it would be a row of
// zeroes on every contract, and a document that reports 0 % moms invites the
// question of whether somebody forgot to fill it in.
//
//   Container queries, not breakpoints. This editor's width is set by whatever
//   it sits in, and it sits beside a contract panel you can drag, so its width
//   changes while the viewport does not move at all. `sm:` asks the wrong
//   question and keeps six controls on one line in 300px.
import { useTranslations } from "next-intl";
import { AmountInput } from "@/components/ui/amount-input";
import { Combobox } from "@/components/ui/combobox";
import { Input, SuffixedInput } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconX } from "@/components/ui/icons";
import { Amount } from "@/components/ui/amount";
import { oreToSEK } from "@/lib/domain/money";
import { linePricing } from "@/lib/contract/rental/pricing";
import { uid } from "@/lib/ui/utils";
import { cn } from "@/lib/ui/utils";
import type { RentalItemOption } from "@/lib/data/rental-items";

export interface LineRow {
  id: string;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  /** Whole per cent, as typed. Empty is none. */
  discountPercent: string;
  replacementValue: string;
}

export const makeLine = (): LineRow => ({
  id: uid(),
  itemId: null,
  description: "",
  quantity: "1",
  unitPrice: "",
  discountPercent: "",
  replacementValue: "",
});

/** What a row is worth, from the strings it holds. The same function the create
 *  route and the document use, so the amount shown is the amount charged. */
export const pricedRow = (r: LineRow, toOre: (s: string) => number) =>
  linePricing({
    quantity: Number(r.quantity) || 0,
    unitPriceOre: toOre(r.unitPrice),
    discountPercent: Number(r.discountPercent) || 0,
  });

export function RentalLines({
  items,
  value,
  onChange,
  /** How much of each catalogue item is free, or undefined before the dates
   *  are set. Drawn on the option itself, so the choice is made with it in
   *  view rather than corrected afterwards. */
  freeFor,
  toOre,
  totalReplacementOre,
}: {
  items: RentalItemOption[];
  value: LineRow[];
  onChange: (rows: LineRow[]) => void;
  freeFor: (itemId: string, exceptId: string) => number | undefined;
  /** Parsing kronor is the form's business, not this component's. */
  toOre: (input: string) => number;
  totalReplacementOre: number;
}) {
  const t = useTranslations("contracts.rental");

  const update = (id: string, patch: Partial<LineRow>) =>
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const pick = (id: string, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    update(id, {
      itemId: item.id,
      description: item.name,
      unitPrice: item.dailyPriceOre === null ? "" : (item.dailyPriceOre / 100).toFixed(2),
      replacementValue: (item.replacementValueOre / 100).toFixed(2),
    });
  };

  const short = (r: LineRow): boolean => {
    if (!r.itemId) return false;
    const left = freeFor(r.itemId, r.id);
    return left !== undefined && (Number(r.quantity) || 0) > left;
  };

  // The column widths, written once. The header and every row read from the
  // same strings, which is what keeps a header sitting over its own column
  // rather than approximately over it.
  const col = {
    qty: "w-16",
    price: "w-28",
    discount: "w-20",
    amount: "w-28",
    replacement: "w-32",
  };

  return (
    <div className="@container">
      {/* The column headers, and only while the row is actually laid out as
          columns. A placeholder inside these boxes has about five characters of
          room next to the "kr", which is not a label; over the column there is
          as much room as the column has. Below @4xl each row stacks and the
          fields are read from their own aria-labels and the values in them. */}
      <div className="hidden items-end gap-3 border-b border-border pb-2 text-xs font-medium text-muted @4xl:flex">
        <span className="flex-1">{t("description")}</span>
        <span className={cn(col.qty, "text-right")}>{t("quantity")}</span>
        <span className={cn(col.price, "text-right")}>{t("unitPriceShort")}</span>
        <span className={cn(col.discount, "text-right")}>{t("discountShort")}</span>
        <span className={cn(col.amount, "text-right")}>{t("lineAmount")}</span>
        <span className={cn(col.replacement, "text-right")}>{t("replacementShort")}</span>
        {/* The remove button's column, so the headers line up with the fields
            rather than with the row's full width. */}
        <span className="w-9" />
      </div>

      {/* A rule between rows rather than a gap, which is how an invoice
          separates its lines and what makes a column of them read as a list of
          amounts rather than as a stack of forms. */}
      <div className="divide-y divide-border">
        {value.map((row) => {
          const priced = pricedRow(row, toOre);
          return (
            <div key={row.id} className="space-y-1 py-3 first:pt-2">
              <div className="flex flex-col gap-2 @4xl:flex-row @4xl:items-center">
                {items.length > 0 ? (
                  <Combobox
                    size="sm"
                    className="@4xl:flex-1"
                    options={items.map((i) => {
                      const left = freeFor(i.id, row.id);
                      return {
                        value: i.id,
                        label:
                          left === undefined
                            ? i.name
                            : `${i.name} – ${t("free", { free: left, owned: i.quantity })}`,
                      };
                    })}
                    value={row.itemId ?? ""}
                    onChange={(v) => pick(row.id, v)}
                    placeholder={t("pickItem")}
                    allowClear
                    aria-label={t("pickItem")}
                  />
                ) : (
                  <Input
                    size="sm"
                    className="@4xl:flex-1"
                    value={row.description}
                    // Typing over the description unlinks the catalogue row: the
                    // line is no longer the item it was drawn from, and keeping
                    // the id would claim a provenance it has lost.
                    onChange={(e) => update(row.id, { description: e.target.value, itemId: null })}
                    placeholder={t("description")}
                    aria-label={t("description")}
                  />
                )}

                <div className="flex min-w-0 items-center gap-3">
                  {/* Sized by a wrapper, not by a class on the control. The
                      control carries `w-full`, and `cn` concatenates rather than
                      merges, so a `w-16` on the input is settled by Tailwind's
                      emission order instead of by intent. */}
                  <div className={col.qty}>
                    <Input
                      size="sm"
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => update(row.id, { quantity: e.target.value })}
                      className="text-right"
                      aria-label={t("quantity")}
                    />
                  </div>
                  <div className={col.price}>
                    <AmountInput
                      size="sm"
                      value={row.unitPrice}
                      onChange={(v) => update(row.id, { unitPrice: v })}
                      suffix="kr"
                      inputClassName="text-right"
                      aria-label={t("unitPrice")}
                    />
                  </div>
                  {/* Per cent rather than kronor, so it survives the quantity
                      changing: two speakers at half price stays half price when
                      it becomes four. */}
                  <div className={col.discount}>
                    <SuffixedInput
                      size="sm"
                      type="number"
                      min={0}
                      max={100}
                      value={row.discountPercent}
                      onChange={(e) => update(row.id, { discountPercent: e.target.value })}
                      placeholder="0"
                      inputClassName="text-right tabular-nums"
                      aria-label={t("discount")}
                      suffix={
                        <span aria-hidden className="shrink-0 text-xs text-muted">
                          %
                        </span>
                      }
                    />
                  </div>
                  {/* Worked out, not typed. The one figure on the row that
                      says what this line actually costs, which is what a reader
                      is scanning the column for. */}
                  <div
                    className={cn(
                      col.amount,
                      "text-right text-sm tabular-nums",
                      priced.discountOre > 0 && "font-medium",
                    )}
                  >
                    <Amount value={oreToSEK(priced.netOre)} />
                  </div>
                  <div className={col.replacement}>
                    <AmountInput
                      size="sm"
                      value={row.replacementValue}
                      onChange={(v) => update(row.id, { replacementValue: v })}
                      suffix="kr"
                      inputClassName="text-right"
                      aria-label={t("replacementValue")}
                    />
                  </div>
                  <IconButton
                    tone="danger"
                    label={t("removeLine")}
                    disabled={value.length <= 1}
                    onClick={() => onChange(value.filter((r) => r.id !== row.id))}
                  >
                    <IconX className="size-4" />
                  </IconButton>
                </div>
              </div>

              {/* What the discount struck off, said on the row it came off
                  rather than only in the total. Without it the amount column
                  is a figure with no working shown. */}
              {priced.discountOre > 0 && (
                <p className="text-xs text-muted @4xl:text-right">
                  {t("lineWas", { gross: `${(priced.grossOre / 100).toFixed(2)} kr` })}
                </p>
              )}
              {/* On the row, where the choice was made. */}
              {short(row) && <p className="text-xs text-danger">{t("unavailable")}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <button
          type="button"
          onClick={() => onChange([...value, makeLine()])}
          className="text-sm font-medium text-accent hover:underline"
        >
          {t("addLine")}
        </button>
        {/* What is at stake, which is not a price and is the one figure the
            liability clause points at. Away from the money below, which is what
            is owed. */}
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {t("totalReplacement")} <Amount value={oreToSEK(totalReplacementOre)} />
        </span>
      </div>
    </div>
  );
}
