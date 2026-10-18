"use client";

// The movements that belong to a product rather than to a night.
//
// A delivery, a stocktake and a write-off are all stock movements and all end
// up in the same log as everything else, but they are not what this feature is
// used for. They happen a few times a term, they are done sitting down with an
// invoice or standing at a shelf with a clipboard, and they ask questions the
// in/out flow never asks. Leaving them in that dialog made the common act pick
// its way past options it never wanted, so they moved here, onto the product
// they are about.
//
// All of them write through the same route as everything else. Nothing here is
// a special kind of stock movement; it is the same log, reached from where the
// question is asked.
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

/** Delivery figures are read against an invoice, so they carry their öre. */
const formatOreKr2 = (ore: number) => formatOreKr(ore, { decimals: 2 });

const today = () => new Date().toISOString().slice(0, 10);

const int = (s: string): number => {
  const n = Number(s.replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

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
  // Why the save button is dead, in the words of the errand. See ModalFooter.
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
              {t("notice.worth", { value: formatOreKr2(product.costPriceOre * count) })}
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
  onPurchaseInstead,
}: {
  product: StockLevelDto;
  onClose: () => void;
  /**
   * Leave the count for a purchase of this many. Offered when the count finds
   * more sealed than the log, which is far more often a delivery somebody is
   * booking in the wrong place than bottles the cellar had lost.
   */
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
              hint={t("stocktake.expected", { count: bottlesAt(product.onHand.open, level) })}
              requirement="required"
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

        <Field label={t("field.date")} requirement="required">
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

        {/* More sealed than the log: was it bought? A stocktake that "finds"
            a delivery books it at the shelf's average, often nothing, and
            leaves it out of the restaurangrapport's bought-in volume. Asked
            here, with the way to the right form one press away, rather than
            discovered later as a shelf worth nothing. */}
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
      {/* No `blocker`: the notice a few lines up already says why a count that
          agrees with the log has nothing to save, and saying it twice on one
          screen is worse than saying it once where it belongs. */}
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
 * A write-off: what broke or went out of date in the cellar.
 *
 * The other half of a spill, and a different kind in the log for the one reason
 * that matters. A spill at a pub is stock the checkout already took off the
 * shelf, so it moves nothing and is booked on the night it happened. This never
 * left the cellar, so it comes off the shelf here, at the moving average, the
 * same way a checkout does. See the StockEntryKind enum in the schema.
 *
 * One rung at a time, because that is what an accident is. A dropped bottle
 * loses everything left in it, so the rung it came off is the whole of what it
 * cost, and two rungs at once would be two accidents wearing one row. A can has
 * no ladder and is never asked.
 *
 * What it will not do is second-guess which bottle broke. The store's usual
 * rule is that open bottles leave before sealed ones, and it has no business
 * here: the sealed one on the top shelf is the one that fell. See `shortfall`
 * in lib/stock/levels.ts, which is what the route checks this against.
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

  // Why the save button is dead, in the words of the errand. See ModalFooter.
  const blocker =
    count <= 0
      ? t("fault.nothingSpilled")
      : count > onShelf
        ? t("fault.moreThanOnShelf", { count: onShelf })
        : null;

  // What the shelf loses. Sealed stock carries the whole value of the product
  // (see lib/stock/value.ts), so an opened bottle is worth nothing to write
  // down: its cost left the books the moment it was opened. Approximate,
  // because the route prices the row at the average it finds when it writes it,
  // and this is the same average read a moment earlier.
  const unitOre =
    product.onHand.units > 0 ? product.onHand.valueOre / product.onHand.units : 0;
  const writeDownOre = level === 0 ? Math.round(unitOre * count) : 0;

  async function save() {
    const body: CreateStockEntry = {
      productId: product.id,
      kind: "SPOILAGE",
      occurredAt,
      level: level as 0 | 80 | 60 | 40 | 20,
      // Negative, because the shelf is what this takes from. The route holds
      // the same rule and refuses the row if the sign and the kind disagree.
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
                ...LEVELS.map((l) => ({ value: String(l), label: t("field.levelOf", { level: l }) })),
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
            <Notice tone="info">{t("spoilage.worth", { value: formatOreKr2(writeDownOre) })}</Notice>
          ) : (
            <Notice tone="info">{t("spoilage.noValue")}</Notice>
          ))}

        {/* Said out loud rather than left to be discovered, because the two
            words mean the same thing to somebody holding a broken bottle and
            the log has to keep them apart. */}
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
