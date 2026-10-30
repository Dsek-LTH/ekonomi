"use client";

// The day's sold lines: what the intäktsräkning beside it is a rendering of,
// and so what the reviewer compares it with.
//
// By account, each section with its sum, products grouped inside it the way
// the document groups them (lib/income/sold-lines.ts). The figures are plain,
// "45,00", with the unit said once in the header, as the voucher editor under
// this table sets them. On the reserv's day, lines rung up with a prefix
// nobody owns are drawn together under it, with the move for all of them on
// the prefix's own row.
//
// The account is text until it is clicked. It is the same number on nearly
// every line, and a picker on every row made each one a control's height,
// a column of identical dropdowns ten rows to a screen.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DragHandle } from "@/components/ui/drag";
import { IconElbow } from "@/components/ui/icons";
import { TableScroll } from "@/components/ui/table-scroll";
import type { IncomeLineRow } from "@/lib/data/income";
import { productDisplayName } from "@/lib/income/product-groups";
import { soldSections } from "@/lib/income/sold-lines";
import { formatNumber } from "@/lib/ui/format";
import { cn } from "@/lib/ui/utils";

type Translator = (key: string, values?: Record<string, string | number>) => string;

const figure = (kr: number) => formatNumber(kr, 2, 2);

export function SoldLinesTable({
  reportId,
  lines,
  reserv,
  canMove,
  picked,
  onPick,
  onMove,
  dragging,
  onDragStart,
  onDragEnd,
  accountOptions,
  onAccount,
  busy,
  t,
}: {
  reportId: string;
  lines: IncomeLineRow[];
  /** The day is the reserv's: its prefixed lines are drawn under the prefix. */
  reserv: boolean;
  /** Lines may be moved to another verksamhet: the grip and the checkboxes. */
  canMove: boolean;
  picked: string[];
  onPick: (lineIds: string[]) => void;
  /** Open the move for these lines. */
  onMove: (lineIds: string[]) => void;
  /** The lines in flight, while a drag is on. */
  dragging: string[] | null;
  onDragStart: (lineIds: string[]) => void;
  onDragEnd: () => void;
  accountOptions: ComboOption[];
  onAccount: (lineId: string, account: string) => void;
  busy: boolean;
  t: Translator;
}) {
  // Which line's account is a picker right now. One at a time: it is opened by
  // the click that asks for it and closes back to text however it ends.
  const [editing, setEditing] = useState<string | null>(null);
  const sections = soldSections(lines, reserv);
  // The document shows a discount column, so the table does when there is
  // anything in it, and leaves it out on the many days with none.
  const discounts = lines.some((l) => l.discount !== 0);
  // Grip and checkbox, then product, account, quantity, unit price, discount,
  // amount.
  const columns = (canMove ? 2 : 0) + 5 + (discounts ? 1 : 0);
  const lead = canMove ? 2 : 0;

  const togglePick = (ids: string[], on: boolean) =>
    onPick(on ? [...new Set([...picked, ...ids])] : picked.filter((id) => !ids.includes(id)));

  return (
    <Card>
      <CardHeader title={t("review.lines")} />
      {/* TableScroll, not a bare `overflow-x-auto`: with nothing setting a
          floor, a `w-full` table always fits its box, so the scroller never
          engaged and the columns squeezed down to a few characters each. */}
      <TableScroll minWidth={canMove ? "min-w-[33rem]" : "min-w-[29rem]"}>
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface text-left text-xs text-muted">
            <tr>
              {canMove && (
                <>
                  {/* The grip's column, outermost. It is what you reach for to
                      pick the row up, and a handle inside the selection column
                      reads as part of the checkbox. */}
                  <th className="w-6 pl-3" />
                  <th className="w-8 py-2 pl-2">
                    <Checkbox
                      checked={picked.length > 0 && picked.length === lines.length}
                      indeterminate={picked.length > 0 && picked.length < lines.length}
                      onChange={() => onPick(picked.length === lines.length ? [] : lines.map((l) => l.id))}
                      label={t("move.selectAll")}
                    />
                  </th>
                </>
              )}
              <th className="px-3 py-2 font-medium">{t("lines.product")}</th>
              <th className="w-20 px-3 py-2 font-medium">{t("lines.account")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("lines.quantity")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("lines.unitPriceKr")}</th>
              {discounts && <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("lines.discountKr")}</th>}
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("lines.totalKr")}</th>
            </tr>
          </thead>
          {sections.map((section) => (
            <tbody key={section.account} className="border-b border-border last:border-0">
              {/* The account the section is credited to and what it comes to:
                  one of the voucher's credit rows, and one of the document's
                  "Fördelning" rows, in the same words and the same figure. */}
              <tr className="bg-surface">
                <td colSpan={columns - 1} className="px-3 py-1.5 text-xs font-medium text-muted">
                  <span className="tnum text-foreground">{section.account}</span>
                  {section.accountName && <span> - {section.accountName}</span>}
                </td>
                <td className="tnum px-3 py-1.5 text-right text-xs font-medium">{figure(section.total)}</td>
              </tr>
              {section.rows.map((row) => {
                if (row.kind === "group") {
                  return (
                    // The product said once, its variants stepped in beneath,
                    // as the intäktsräkning lays them out.
                    <tr key={row.key}>
                      {canMove && <td colSpan={2} />}
                      <td colSpan={columns - lead} className="px-3 pb-0.5 pt-2 font-medium">
                        {row.name}
                      </td>
                    </tr>
                  );
                }
                if (row.kind === "prefix") {
                  const ids = row.lines.map((l) => l.id);
                  const all = ids.every((id) => picked.includes(id));
                  return (
                    // A prefix nobody owns, and every line rung up with it.
                    // Said as the reason the lines are here, and moved as one.
                    <tr key={row.key}>
                      {canMove && (
                        <>
                          <td />
                          <td className="pl-2 pt-2">
                            <Checkbox
                              checked={all}
                              indeterminate={!all && ids.some((id) => picked.includes(id))}
                              onChange={() => togglePick(ids, !all)}
                              label={t("lines.selectPrefix", { prefix: row.prefix })}
                            />
                          </td>
                        </>
                      )}
                      <td colSpan={columns - lead} className="px-3 pb-0.5 pt-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="rounded-control border border-warning/30 bg-warning-soft px-1.5 font-mono text-xs font-semibold text-warning">
                            {row.prefix}
                          </span>
                          <span className="text-xs text-muted">
                            {t("lines.unknownPrefix", { count: row.lines.length })}
                          </span>
                          {canMove && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onMove(ids)}>
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
                return (
                  // `group` so the drag handle appears on hover. See
                  // components/ui/drag.tsx.
                  <tr
                    key={row.key}
                    className={cn("group [&>td]:align-middle", dragging?.includes(line.id) && "opacity-40")}
                  >
                    {canMove && (
                      <>
                        <td className="py-1.5 pl-3">
                          <DragHandle
                            title={t("move.dragHint")}
                            className="flex items-center text-faint hover:text-muted"
                            onDragStart={(e) => {
                              // Dragging a checked row takes the whole
                              // selection; dragging an unchecked one is about
                              // that row alone.
                              const lineIds = picked.includes(line.id) ? picked : [line.id];
                              e.dataTransfer.setData("incomeLines", JSON.stringify({ reportId, lineIds }));
                              e.dataTransfer.effectAllowed = "move";
                              onDragStart(lineIds);
                            }}
                            onDragEnd={onDragEnd}
                          />
                        </td>
                        <td className="py-1.5 pl-2">
                          <Checkbox
                            checked={picked.includes(line.id)}
                            onChange={() => togglePick([line.id], !picked.includes(line.id))}
                            // The whole name: out of the table "Ost" is not a
                            // product.
                            label={t("move.selectLine", { product: name })}
                          />
                        </td>
                      </>
                    )}
                    <td className="px-3 py-1.5">
                      {row.indented ? (
                        <span className="flex items-center gap-1.5 pl-4">
                          {/* The same elbow the document draws, lighter than
                              the name it leads into. */}
                          <IconElbow className="size-3.5 shrink-0 text-faint opacity-60" />
                          {row.label}
                        </span>
                      ) : (
                        row.label
                      )}
                    </td>
                    <td className="px-3 py-1">
                      {editing === line.id ? (
                        <Combobox
                          size="sm"
                          options={accountOptions}
                          value={line.account}
                          openOnMount
                          autoFocus
                          onClose={() => setEditing(null)}
                          onChange={(v) => {
                            setEditing(null);
                            if (v !== line.account) onAccount(line.id, v);
                          }}
                          disabled={busy}
                          aria-label={t("lines.accountFor", { product: name })}
                        />
                      ) : (
                        // Editable in place. A sale that fell to the reserv is
                        // on the reserv's account, and that is as likely to need
                        // correcting as the verksamhet it landed in.
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEditing(line.id)}
                          title={t("lines.changeAccount")}
                          aria-label={t("lines.accountFor", { product: name })}
                          className="tnum -mx-1.5 rounded-control px-1.5 py-0.5 text-left hover:bg-hover"
                        >
                          {line.account}
                        </button>
                      )}
                    </td>
                    <td className="tnum px-3 py-1.5 text-right">{line.quantity}</td>
                    <td className="tnum px-3 py-1.5 text-right">{figure(line.unitPrice)}</td>
                    {discounts && (
                      <td className="tnum px-3 py-1.5 text-right text-muted">
                        {line.discount ? figure(line.discount) : ""}
                      </td>
                    )}
                    <td className="tnum px-3 py-1.5 text-right font-medium">{figure(line.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </TableScroll>
      {/* Only once something is picked: an action bar on a day nobody is
          correcting is a row of controls to read past. */}
      {canMove && picked.length > 0 && (
        <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
          <span className="text-sm text-muted">{t("move.picked", { count: picked.length })}</span>
          <Button onClick={() => onMove(picked)}>{t("move.action")}</Button>
        </CardBody>
      )}
    </Card>
  );
}
