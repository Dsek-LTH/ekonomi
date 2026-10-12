"use client";

// Putting a delivery right.
//
// The case it exists for: somebody books 200 bottles of Fireball meaning 20.
// The old answer was a second row of −180, which left the log saying the guild
// once bought two hundred bottles it never bought, and made fixing a typo an
// arithmetic problem, at the moment somebody has just demonstrated they are not
// doing arithmetic well.
//
// So it asks the only question worth asking: what should it have been? Zero, or
// the remove button, takes the row away entirely, because picking the wrong
// product is not a movement of nothing. It is no movement.
//
// Who changed it, and from what, goes to the product's own feed. That is what
// keeps an editable ledger checkable, and it is the reason none of this has to
// be expressed as a correction the reader then has to add up.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { useMutation } from "@/components/shell/use-mutation";
import { isQuantityInput, quantity } from "@/lib/stock/quantity";
import type { PatchStockEntry } from "@/lib/api/schemas/stock";
import type { CellarRowDto } from "@/lib/data/stock";

/**
 * The figure the row shows a person: positive, in things.
 *
 * Read off the rung the row is about, not off `units`, because a row about an
 * opened bottle leaves that at nought and puts its one bottle on the ladder.
 * The same rule the route applies when it writes the row back. See
 * api/stock/entries/[id]/route.ts.
 */
const shown = (row: CellarRowDto): number => {
  const level = row.level ?? 0;
  if (level === 0) return Math.abs(row.units ?? 0);
  return Math.abs(row.open?.[level as 80] ?? 0);
};

export function EntryDialog({
  row,
  onClose,
}: {
  row: CellarRowDto;
  onClose: () => void;
}) {
  const t = useTranslations("stock");
  const { pending, mutate } = useMutation();
  const was = shown(row);
  const [text, setText] = useState(String(was));

  const parsed = quantity(text);
  const qty = parsed.ok ? parsed.value : was;

  async function save(next: number) {
    const body: PatchStockEntry = { qty: next };
    const done =
      next === 0
        ? await mutate(`/api/stock/entries/${row.id}`, {
            method: "DELETE",
            error: t("entry.failed"),
          })
        : await mutate(`/api/stock/entries/${row.id}`, {
            method: "PATCH",
            body,
            error: t("entry.failed"),
          });
    if (done !== null) onClose();
  }

  return (
    <Modal label={t("entry.title")} onClose={onClose} className="max-w-md">
      <ModalHeader
        title={t("entry.title")}
        subtitle={t("entry.hint", {
          kind: t(`kind.${row.kind}`),
          date: row.occurredAt ?? row.at.slice(0, 10),
        })}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        <Field label={t("entry.qty")} hint={t("entry.qtyHint", { was })} requirement="required">
          <Input
            value={text}
            inputMode="numeric"
            className="tabular-nums"
            autoFocus
            onChange={(e) => isQuantityInput(e.target.value) && setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save(qty);
            }}
          />
        </Field>
      </div>
      {/* The blocker is about the save button alone. Removing the row is still
          live while it shows, which is the point of saying which button is
          waiting for what rather than greying the strip out. */}
      <ModalFooter blocker={qty === was ? t("entry.unchanged") : null}>
        {/* Removing it outright, for the row that should never have existed.
            Not a destructive act on the record: the product's feed keeps what
            it said and who took it off. */}
        <Button variant="ghost" onClick={() => void save(0)} disabled={pending !== null}>
          {t("entry.remove")}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save(qty)} disabled={pending !== null || qty === was}>
            {t("entry.save")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
