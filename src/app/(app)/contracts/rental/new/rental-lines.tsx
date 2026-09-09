"use client";

// The gear on an uthyrningsavtal, as the lines of an invoice.
//
// A real table now, styled the way every other line-item grid in this app is
// (the voucher editor, the budget sheet): a header row over tight, bordered
// cells rather than a stack of little forms. A renter reading the drawn
// contract sees the same columns in the same order, so the form and the
// document are one thing seen twice rather than two.
//
// TableScroll, not a responsive stack that reflows below some width: this
// editor sits beside a contract panel that can be dragged, so its width
// changes while the viewport does not move at all, and a table that folds
// itself into cards at a breakpoint would be folding and unfolding as the
// panel moves. A sheet scrolls sideways inside its own card instead, which is
// also what keeps a narrow embed from chaining a sideways swipe to the
// browser's own back gesture. See components/ui/table-scroll.tsx.
//
// No VAT column. The section is momsbefriad, so a line for it would be a row of
// zeroes on every contract, and a document that reports 0 % moms invites the
// question of whether somebody forgot to fill it in.
import { Fragment, useEffect } from "react";
import { useTranslations } from "next-intl";
import { amountFieldProps } from "@/components/ui/amount-input";
import { Combobox } from "@/components/ui/combobox";
import { IconButton } from "@/components/ui/icon-button";
import { IconX } from "@/components/ui/icons";
import { Amount } from "@/components/ui/amount";
import { TableScroll } from "@/components/ui/table-scroll";
import { withBlankRows } from "@/lib/ui/blank-rows";
import { oreToSEK } from "@/lib/domain/money";
import { linePricing } from "@/lib/contract/rental/pricing";
import { uid, cn } from "@/lib/ui/utils";
import type { RentalItemOption } from "@/lib/data/rental-items";

export interface LineRow {
  id: string;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  /** As typed: a whole percentage when `discountUnit` is "percent", or an
   *  amount in kr off the line when it is "kr". Empty is none. */
  discount: string;
  discountUnit: "percent" | "kr";
  replacementValue: string;
}

export const makeLine = (): LineRow => ({
  id: uid(),
  itemId: null,
  description: "",
  quantity: "",
  unitPrice: "",
  discount: "",
  discountUnit: "percent",
  replacementValue: "",
});

/**
 * What the line's discount comes to as a whole percentage, which is the only
 * shape the row, the create route and the document actually store (see
 * RentalLine.discountPercent in the schema, and the note there on why: it
 * survives the quantity changing, where a fixed amount could not).
 *
 * A kr discount is converted against the line's *current* gross, so it
 * behaves the way a percentage already does when a line is edited: "50 kr
 * off" at 500 kr is the 10 % it was typed as, and stays 10 % if the
 * quantity later changes, the same as if 10 % had been typed directly.
 * Retyping is what moves it back to a fixed 50 kr at the new gross.
 */
export function effectiveDiscountPercent(r: LineRow, toOre: (s: string) => number): number {
  if (r.discountUnit === "percent") return Number(r.discount) || 0;
  const gross = Math.round((Number(r.quantity) || 0) * toOre(r.unitPrice));
  if (gross <= 0) return 0;
  return Math.round((toOre(r.discount) / gross) * 100);
}

/** What a row is worth, from the strings it holds. The same function the create
 *  route and the document use, so the amount shown is the amount charged. */
export const pricedRow = (r: LineRow, toOre: (s: string) => number) =>
  linePricing({
    quantity: Number(r.quantity) || 0,
    unitPriceOre: toOre(r.unitPrice),
    discountPercent: effectiveDiscountPercent(r, toOre),
  });

/**
 * A row nobody has put anything in: no item picked and no description typed.
 * Quantity, price and discount play no part in this, so a row somebody has
 * only touched by typing a quantity is still blank. The same rule
 * new-rental-client.tsx's own `filled` used to compute independently,
 * sharing it here is what lets the spare-row topping-up below and the
 * caller's own filtering agree by construction rather than by two people
 * remembering to change both.
 */
export const isBlankLineRow = (r: LineRow) => !r.itemId && !r.description.trim();

const headerCell = "px-2 py-2.5 text-right font-medium";
const cellInput =
  "block h-10 w-full bg-transparent px-2 text-right text-sm tabular-nums placeholder:text-muted focus-inset";
const cellCombo = "h-10 gap-1 bg-transparent px-2 focus-inset";
// A sheet reads as a spreadsheet, and a spreadsheet cell doesn't grow a
// pair of arrows the moment a number lands in it. Chrome/Safari draw their
// own on `type="number"` regardless of any CSS `appearance`, which is what
// the two pseudo-elements below are for; Firefox honours `appearance` on
// the input itself.
const noSpinner =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

export function RentalLines({
  items,
  value,
  onChange,
  /** How much of each catalogue item is free, or undefined before the dates
   *  are set. Drawn on the option itself, so the choice is made with it in
   *  view rather than corrected afterwards. */
  freeFor,
  toOre,
  /** How many empty rows the sheet keeps topped up, so there is always
   *  somewhere to write the next line without reaching for an "add row"
   *  button. See lib/ui/blank-rows.ts, which is what actually keeps the
   *  count. */
  blankRows = 1,
}: {
  items: RentalItemOption[];
  value: LineRow[];
  onChange: (rows: LineRow[]) => void;
  freeFor: (itemId: string, exceptId: string) => number | undefined;
  /** Parsing kronor is the form's business, not this component's. */
  toOre: (input: string) => number;
  blankRows?: number;
}) {
  const t = useTranslations("contracts.rental");

  // Keep exactly `blankRows` empty rows stocked. See withBlankRows for why
  // this counts rows anywhere in the list rather than only trailing ones.
  const stocked = withBlankRows(value, blankRows, isBlankLineRow, makeLine);
  useEffect(() => {
    if (stocked) onChange(stocked);
  }, [stocked, onChange]);

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

  /**
   * Whether the two catalogue-sourced figures can still be typed into by
   * hand. With no catalogue at all there's nothing for them to come from, so
   * both stay free text as before. Once there is one, `pick` is what fills
   * them, and retyping over what it wrote would let a line quietly disagree
   * with the item it's supposedly the price of. The one exception is a price
   * the catalogue itself doesn't set (RentalItem.dailyPriceOre null,
   * "priced case by case"): `pick` leaves that blank on purpose, and a blank
   * field nobody can type into would never get a price at all.
   */
  const priceEditable = (r: LineRow): boolean => {
    if (items.length === 0) return true;
    const item = items.find((i) => i.id === r.itemId);
    return item !== undefined && item.dailyPriceOre === null;
  };
  const replacementEditable = items.length === 0;

  /**
   * Switches a line between typing the discount as a percentage and as a kr
   * amount, converting what's already there so the discount itself doesn't
   * change, only how it's written. Against the line's current gross, the
   * same conversion `effectiveDiscountPercent` runs the other way.
   */
  const toggleDiscountUnit = (r: LineRow) => {
    const gross = Math.round((Number(r.quantity) || 0) * toOre(r.unitPrice));
    if (r.discount.trim() === "") {
      update(r.id, { discountUnit: r.discountUnit === "percent" ? "kr" : "percent" });
      return;
    }
    if (r.discountUnit === "percent") {
      const kr = gross > 0 ? (gross * (Number(r.discount) || 0)) / 100 / 100 : 0;
      update(r.id, { discountUnit: "kr", discount: kr.toFixed(2) });
    } else {
      const percent = gross > 0 ? Math.round((toOre(r.discount) / gross) * 100) : 0;
      update(r.id, { discountUnit: "percent", discount: String(Math.min(100, Math.max(0, percent))) });
    }
  };

  return (
    <TableScroll minWidth="min-w-[46rem]">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="divide-x divide-border border-b border-border bg-surface text-xs text-muted">
            <th className="w-[32%] px-2 py-2.5 text-left font-medium">{t("description")}</th>
            <th className={cn(headerCell, "w-[9%]")}>{t("quantity")}</th>
            <th className={cn(headerCell, "w-[14%]")}>{t("unitPriceShort")}</th>
            <th className={cn(headerCell, "w-[10%]")}>{t("discountShort")}</th>
            <th className={cn(headerCell, "w-[13%]")}>{t("lineAmount")}</th>
            <th className={cn(headerCell, "w-[15%]")}>{t("replacementShort")}</th>
            <th className="w-[7%]" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {value.map((row) => {
            const priced = pricedRow(row, toOre);
            const note = priced.discountOre > 0 || short(row);
            // A spare row has nothing to remove, the same rule the
            // voucher sheet follows: removing "nothing" is not a thing to
            // offer, and the row disappears on its own the moment
            // something else fills the spares back up to `blankRows`.
            const removable = !isBlankLineRow(row);
            return (
              <Fragment key={row.id}>
                <tr className="divide-x divide-border">
                  <td className="p-0 align-middle">
                    {items.length > 0 ? (
                      <Combobox
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
                        align="left"
                        buttonClassName={cn(cellCombo, "justify-between")}
                        aria-label={t("pickItem")}
                      />
                    ) : (
                      <input
                        size={1}
                        value={row.description}
                        // Typing over the description unlinks the catalogue
                        // row: the line is no longer the item it was drawn
                        // from, and keeping the id would claim a provenance
                        // it has lost.
                        onChange={(e) =>
                          update(row.id, { description: e.target.value, itemId: null })
                        }
                        placeholder={t("description")}
                        aria-label={t("description")}
                        className="block h-10 w-full bg-transparent px-2 text-sm placeholder:text-muted focus-inset"
                      />
                    )}
                  </td>
                  <td className="p-0 align-middle">
                    <input
                      size={1}
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => update(row.id, { quantity: e.target.value })}
                      aria-label={t("quantity")}
                      className={cn(cellInput, noSpinner)}
                    />
                  </td>
                  <td
                    className={
                      priceEditable(row)
                        ? "p-0 align-middle"
                        : "px-2 text-right align-middle text-sm tabular-nums text-muted"
                    }
                  >
                    {priceEditable(row) ? (
                      <input
                        size={1}
                        {...amountFieldProps({
                          value: row.unitPrice,
                          onChange: (v) => update(row.id, { unitPrice: v }),
                        })}
                        aria-label={t("unitPrice")}
                        className={cellInput}
                      />
                    ) : row.unitPrice ? (
                      <Amount value={oreToSEK(toOre(row.unitPrice))} />
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="p-0 align-middle">
                    {/* Either unit is stored as a percentage in the end
                        (see effectiveDiscountPercent, and the comment on
                        RentalLine.discountPercent in the schema for why):
                        this is only which way it's typed. The toggle
                        converts what's already there rather than relabel
                        it, so switching units doesn't change the
                        discount. */}
                    <div className="flex h-10 items-center">
                      {row.discountUnit === "percent" ? (
                        <input
                          size={1}
                          type="number"
                          min={0}
                          max={100}
                          value={row.discount}
                          onChange={(e) => update(row.id, { discount: e.target.value })}
                          aria-label={t("discount")}
                          className={cn(cellInput, noSpinner, "min-w-0 flex-1")}
                        />
                      ) : (
                        <input
                          size={1}
                          {...amountFieldProps({
                            value: row.discount,
                            onChange: (v) => update(row.id, { discount: v }),
                          })}
                          aria-label={t("discount")}
                          className={cn(cellInput, "min-w-0 flex-1")}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => toggleDiscountUnit(row)}
                        title={t("discountUnitToggle")}
                        className="shrink-0 pe-2 text-xs text-muted hover:text-foreground focus-inset"
                      >
                        {row.discountUnit === "percent" ? "%" : "kr"}
                      </button>
                    </div>
                  </td>
                  {/* Worked out, not typed. The one figure on the row that
                      says what this line actually costs, which is what a
                      reader is scanning the column for. */}
                  <td
                    className={cn(
                      "px-2 text-right align-middle text-sm tabular-nums",
                      priced.discountOre > 0 && "font-medium",
                    )}
                  >
                    <Amount value={oreToSEK(priced.netOre)} />
                  </td>
                  <td
                    className={
                      replacementEditable
                        ? "p-0 align-middle"
                        : "px-2 text-right align-middle text-sm tabular-nums text-muted"
                    }
                  >
                    {replacementEditable ? (
                      <input
                        size={1}
                        {...amountFieldProps({
                          value: row.replacementValue,
                          onChange: (v) => update(row.id, { replacementValue: v }),
                        })}
                        aria-label={t("replacementValue")}
                        className={cellInput}
                      />
                    ) : row.replacementValue ? (
                      <Amount value={oreToSEK(toOre(row.replacementValue))} />
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="text-center align-middle">
                    {removable && (
                      <IconButton
                        tone="danger"
                        size="sm"
                        label={t("removeLine")}
                        onClick={() => onChange(value.filter((r) => r.id !== row.id))}
                      >
                        <IconX className="size-4" />
                      </IconButton>
                    )}
                  </td>
                </tr>
                {/* What the discount struck off, or that the catalogue can't
                    cover the quantity, said on the row it belongs to. A
                    second row rather than a second line inside a cell: a
                    table's cells hold one fact each, and a note is a
                    different fact from the ones either side of it. */}
                {note && (
                  <tr key={`${row.id}-note`} className="bg-surface/60">
                    <td colSpan={7} className="space-y-0.5 px-2 py-1 text-xs">
                      {priced.discountOre > 0 && (
                        <p className="text-muted">
                          {t("lineWas", { gross: `${(priced.grossOre / 100).toFixed(2)} kr` })}
                        </p>
                      )}
                      {short(row) && <p className="text-danger">{t("unavailable")}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}
