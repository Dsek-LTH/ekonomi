"use client";

// The two movements that belong to a product rather than to a night.
//
// A delivery and a stocktake are both stock movements and both end up in the
// same log as everything else, but they are not what this feature is used for.
// They happen a few times a term, they are done sitting down with an invoice or
// standing at a shelf with a clipboard, and they ask questions the in/out flow
// never asks. Leaving them in that dialog made the common act pick its way past
// two options it never wanted, so they moved here, onto the product they are
// about.
//
// Both write through the same route as everything else. Nothing here is a
// special kind of stock movement; it is the same log, reached from where the
// question is asked.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DateInput, Field, Input } from "@/components/ui/field";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { useMutation } from "@/components/shell/use-mutation";
import type { StockLevelDto } from "@/lib/data/stock";
import type { CreateStockEntry } from "@/lib/api/schemas/stock";
import { LEVELS, bottlesAt, type OpenBottles } from "@/lib/stock/levels";

const today = () => new Date().toISOString().slice(0, 10);

const int = (s: string): number => {
  const n = Number(s.replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const kr = (ore: number) =>
  `${new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ore / 100)} kr`;

/**
 * A delivery.
 *
 * Sealed units and a date, and that is the whole form. What it is worth is the
 * product's own price times the count (see lib/stock/value.ts) so the one
 * thing this says out loud is what the shelf is about to be worth, or that it
 * will be worth nothing because nobody has priced the product.
 */
export function PurchaseDialog({
  product,
  onClose,
}: {
  product: StockLevelDto;
  onClose: () => void;
}) {
  const t = useTranslations("stock");
  const { pending, mutate } = useMutation();
  const [units, setUnits] = useState("");
  const [occurredAt, setOccurredAt] = useState(today());
  const [note, setNote] = useState("");

  const count = int(units);

  async function save() {
    const body: CreateStockEntry = {
      productId: product.id,
      kind: "PURCHASE",
      occurredAt,
      units: count,
      note: note.trim() || undefined,
    };
    const saved = await mutate("/api/stock/entries", {
      body,
      error: t("saveFailed"),
      success: t("saved"),
    });
    if (saved) onClose();
  }

  return (
    <Modal label={t("purchase.title")} onClose={onClose} className="max-w-md">
      <ModalHeader title={t("purchase.title")} subtitle={product.name} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        <Field
          label={product.kind === "VOLUME" ? t("purchase.bottles") : t("purchase.units")}
          hint={t("purchase.sealedHint")}
        >
          <Input
            inputMode="numeric"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </Field>

        <Field label={t("field.date")}>
          <DateInput value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>

        {product.costPriceOre == null ? (
          <Notice tone="warning">{t("notice.noCostPrice")}</Notice>
        ) : (
          count > 0 && (
            <Notice tone="info">
              {t("notice.worth", { value: kr(product.costPriceOre * count) })}
            </Notice>
          )
        )}

        <Field label={t("field.note")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-inset py-3">
        <Button variant="secondary" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={count <= 0} loading={pending !== null}>
          {t("save")}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * A stocktake.
 *
 * You say what is actually there, not how far it is from what the system
 * thought, which is arithmetic nobody should be doing standing at a shelf. The
 * route subtracts what it expected and writes the difference, so the log records
 * the correction rather than the count.
 *
 * The expected figures are shown beside each field, because a stocktake whose
 * expectations are hidden is one people copy the system's numbers into.
 * Deliberately not pre-filled for the same reason.
 */
export function StocktakeDialog({
  product,
  onClose,
}: {
  product: StockLevelDto;
  onClose: () => void;
}) {
  const t = useTranslations("stock");
  const { pending, mutate } = useMutation();
  const [sealed, setSealed] = useState("");
  const [open, setOpen] = useState<OpenBottles>({});
  const [occurredAt, setOccurredAt] = useState(today());
  const [note, setNote] = useState("");

  const isVolume = product.kind === "VOLUME";
  const countedSealed = int(sealed);
  const diffSealed = countedSealed - product.onHand.units;
  const diffOpen = LEVELS.map((l) => bottlesAt(open, l) - bottlesAt(product.onHand.open, l));
  const anyDifference = diffSealed !== 0 || diffOpen.some((n) => n !== 0);

  async function save() {
    const body: CreateStockEntry = {
      productId: product.id,
      kind: "COUNT",
      occurredAt,
      counted: {
        sealed: countedSealed,
        open: isVolume
          ? Object.fromEntries(LEVELS.map((l) => [String(l), bottlesAt(open, l)]))
          : undefined,
      },
      note: note.trim() || undefined,
    };
    const saved = await mutate("/api/stock/entries", {
      body,
      error: t("saveFailed"),
      success: t("saved"),
    });
    if (saved) onClose();
  }

  return (
    <Modal label={t("stocktake.title")} onClose={onClose} className="max-w-md">
      <ModalHeader title={t("stocktake.title")} subtitle={product.name} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        <p className="text-sm text-muted">{t("stocktake.lead")}</p>

        <Field
          label={isVolume ? t("stocktake.sealed") : t("stocktake.units")}
          hint={t("stocktake.expected", { count: product.onHand.units })}
        >
          <Input
            inputMode="numeric"
            value={sealed}
            onChange={(e) => setSealed(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </Field>

        {isVolume &&
          LEVELS.map((level) => (
            <Field
              key={level}
              label={t("field.levelOf", { level })}
              hint={t("stocktake.expected", { count: bottlesAt(product.onHand.open, level) })}
            >
              <Input
                inputMode="numeric"
                value={open[level]?.toString() ?? ""}
                onChange={(e) =>
                  setOpen((prev) => ({ ...prev, [level]: int(e.target.value) }))
                }
                placeholder="0"
              />
            </Field>
          ))}

        <Field label={t("field.date")}>
          <DateInput value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>

        {/* A count that agrees with the log is still worth recording. It is
            evidence somebody looked, but it writes no movement, so say so
            rather than let the button look broken. */}
        <Notice tone={anyDifference ? "warning" : "info"}>
          {anyDifference
            ? t("stocktake.difference", {
                sealed: diffSealed > 0 ? `+${diffSealed}` : String(diffSealed),
              })
            : t("stocktake.agrees")}
        </Notice>

        <Field label={t("field.note")} hint={t("stocktake.noteHint")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-inset py-3">
        <Button variant="secondary" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={!anyDifference} loading={pending !== null}>
          {t("save")}
        </Button>
      </div>
    </Modal>
  );
}
