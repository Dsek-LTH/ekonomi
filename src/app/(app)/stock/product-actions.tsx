"use client";

// Movements that belong to a product rather than a night (delivery, stocktake, write-off). They write through the same route and log as everything else.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DateInput, Field, Input } from "@/components/ui/field";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { useMutation } from "@/components/shell/use-mutation";
import type { StockLevelDto } from "@/lib/data/stock";
import type { CreateStockEntry } from "@/lib/api/schemas/stock";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { LEVELS, bottlesAt, type Level, type OpenBottles } from "@/lib/stock/levels";
import { formatOreKr } from "@/lib/ui/format";
import { today } from "@/lib/domain/date";

const int = (s: string): number => {
  const n = Number(s.replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** A delivery: sealed units and a date. Says what the shelf is about to be worth (price times count, lib/stock/value.ts), or nothing if the product is unpriced. */
export function PurchaseDialog({
  product,
  onClose,
  initialUnits,
}: {
  product: StockLevelDto;
  onClose: () => void;
  /** Filled in, when it comes from a stocktake that found this many more. */
  initialUnits?: number;
}) {
  const t = useTranslations("stock");
  const { pending, mutate } = useMutation();
  const [units, setUnits] = useState(initialUnits ? String(initialUnits) : "");
  const [occurredAt, setOccurredAt] = useState(today());
  const [note, setNote] = useState("");

  const count = int(units);
  // Why the save button is dead (see ModalFooter).
  const blocker = count <= 0 ? t("fault.purchaseNothing") : null;

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
          requirement="required"
        >
          <Input
            inputMode="numeric"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </Field>

        <Field label={t("field.date")} requirement="required">
          <DateInput value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>

        {product.costPriceOre == null ? (
          <Notice tone="warning">{t("notice.noCostPrice")}</Notice>
        ) : (
          count > 0 && (
            <Notice tone="info">
              {t("notice.worth", {
                value: formatOreKr(product.costPriceOre * count, { decimals: 2 }),
              })}
            </Notice>
          )
        )}

        <Field label={t("field.note")} requirement="optional">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <ModalFooter blocker={blocker}>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={Boolean(blocker)} loading={pending !== null}>
            {t("save")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}

/**
 * A stocktake: you say what is actually there, and the route subtracts what it expected and writes the difference.
 * Expected figures are shown beside each field but deliberately not pre-filled, or people copy them.
 */
export function StocktakeDialog({
  product,
  onClose,
  onPurchaseInstead,
}: {
  product: StockLevelDto;
  onClose: () => void;
  /** Leave the count for a purchase of this many: offered when the count finds more sealed than the log, usually a misplaced delivery. */
  onPurchaseInstead?: (units: number) => void;
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
          requirement="required"
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
              hint={t("stocktake.expected", {
                count: bottlesAt(product.onHand.open, level),
              })}
              requirement="required"
            >
              <Input
                inputMode="numeric"
                value={open[level]?.toString() ?? ""}
                onChange={(e) => setOpen((prev) => ({ ...prev, [level]: int(e.target.value) }))}
                placeholder="0"
              />
            </Field>
          ))}

        <Field label={t("field.date")} requirement="required">
          <DateInput value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>

        {/* A count that agrees with the log writes no movement, so say so rather than let the button look broken. */}
        <Notice tone={anyDifference ? "warning" : "info"}>
          {anyDifference
            ? t("stocktake.difference", {
                sealed: diffSealed > 0 ? `+${diffSealed}` : String(diffSealed),
              })
            : t("stocktake.agrees")}
        </Notice>

        {/* More sealed than the log: a stocktake "finding" a delivery books it at the shelf's average and leaves it out of the restaurangrapport's bought-in volume. */}
        {diffSealed > 0 && onPurchaseInstead && (
          <Notice>
            <p>{t("stocktake.wasBought", { count: diffSealed })}</p>
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={() => onPurchaseInstead(diffSealed)}>
                {t("stocktake.purchaseInstead")}
              </Button>
            </div>
          </Notice>
        )}

        <Field label={t("field.note")} hint={t("stocktake.noteHint")} requirement="optional">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {/* No `blocker`: the notice above already says why there is nothing to save. */}
      <ModalFooter>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={!anyDifference} loading={pending !== null}>
            {t("save")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}

/**
 * A write-off: what broke or went out of date in the cellar. Unlike a pub spill (already taken off by the checkout)
 * it comes off the shelf here, at the moving average (see StockEntryKind in the schema).
 * One rung at a time: a dropped bottle loses everything left in it. Which bottle broke is not second-guessed
 * (the sealed one may be what fell), see `shortfall` in lib/stock/levels.ts.
 */
export function SpoilageDialog({
  product,
  onClose,
}: {
  product: StockLevelDto;
  onClose: () => void;
}) {
  const t = useTranslations("stock");
  const { pending, mutate } = useMutation();
  const isVolume = product.kind === "VOLUME";
  const [level, setLevel] = useState(0);
  const [qty, setQty] = useState("");
  const [occurredAt, setOccurredAt] = useState(today());
  const [note, setNote] = useState("");

  const count = int(qty);
  const onShelf =
    level === 0 ? product.onHand.units : bottlesAt(product.onHand.open, level as Level);

  // Why the save button is dead (see ModalFooter).
  const blocker =
    count <= 0
      ? t("fault.nothingSpilled")
      : count > onShelf
        ? t("fault.moreThanOnShelf", { count: onShelf })
        : null;

  // What the shelf loses: sealed stock carries the product's whole value (lib/stock/value.ts), so an opened bottle writes down nothing.
  // Approximate, since the route prices at the average it finds when it writes.
  const unitOre = product.onHand.units > 0 ? product.onHand.valueOre / product.onHand.units : 0;
  const writeDownOre = level === 0 ? Math.round(unitOre * count) : 0;

  async function save() {
    const body: CreateStockEntry = {
      productId: product.id,
      kind: "SPOILAGE",
      occurredAt,
      level: level as 0 | 80 | 60 | 40 | 20,
      // Negative, because the shelf is what this takes from. The route refuses the row if sign and kind disagree.
      units: level === 0 ? -count : 0,
      open: level === 0 ? undefined : { [String(level)]: -count },
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
    <Modal label={t("spoilage.title")} onClose={onClose} className="max-w-md">
      <ModalHeader title={t("spoilage.title")} subtitle={product.name} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        <p className="text-sm text-muted">{t("spoilage.lead")}</p>

        {isVolume && (
          <Field label={t("spoilage.level")} requirement="required">
            <SegmentedControl
              value={String(level)}
              onChange={(v) => setLevel(Number(v))}
              options={[
                { value: "0", label: t("spoilage.sealed") },
                ...LEVELS.map((l) => ({
                  value: String(l),
                  label: t("field.levelOf", { level: l }),
                })),
              ]}
            />
          </Field>
        )}

        <Field
          label={isVolume ? t("spoilage.bottles") : t("spoilage.units")}
          hint={t("spoilage.onShelf", { count: onShelf })}
          requirement="required"
        >
          <Input
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </Field>

        <Field label={t("field.date")} requirement="required">
          <DateInput value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>

        {count > 0 &&
          (writeDownOre > 0 ? (
            <Notice tone="info">
              {t("spoilage.worth", {
                value: formatOreKr(writeDownOre, { decimals: 2 }),
              })}
            </Notice>
          ) : (
            <Notice tone="info">{t("spoilage.noValue")}</Notice>
          ))}

        {/* The two words mean the same to someone holding a broken bottle, and the log keeps them apart. */}
        <Notice tone="warning">{t("spoilage.atEvent")}</Notice>

        <Field label={t("field.note")} hint={t("spoilage.noteHint")} requirement="optional">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <ModalFooter blocker={blocker}>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={Boolean(blocker)} loading={pending !== null}>
            {t("save")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
