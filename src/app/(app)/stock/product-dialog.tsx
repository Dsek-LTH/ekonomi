"use client";

// The form a product is created and corrected in, opened from the list (new) and from the product page (existing).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { TagChips } from "@/components/stock/tag-chips";
import { AmountInput } from "@/components/ui/amount-input";
import { Field, FieldGroup, Input, SuffixedInput } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconScan } from "@/components/ui/icons";
import { BarcodeScanner } from "@/components/stock/barcode-scanner";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { useMutation } from "@/components/shell/use-mutation";
import type { StockProductDto } from "@/lib/data/stock";
import type { CreateStockProduct } from "@/lib/api/schemas/stock";
import { parseSystembolagetId } from "@/lib/stock/systembolaget";
import { MAX_TAG, MAX_TAGS, cleanTags, hasTag } from "@/lib/stock/tags";
import { isInternalCode, validGtin } from "@/lib/stock/barcode";
import type { DrinkCategory, StockKind } from "@/lib/domain/types";
import { CATEGORIES } from "@/lib/domain/categories";
import { Checkbox } from "@/components/ui/checkbox";

const KIND_OPTIONS: StockKind[] = ["UNIT", "VOLUME"];

type Draft = {
  name: string;
  kind: StockKind;
  category: DrinkCategory;
  abv: string;
  unitMl: string;
  nominalMl: string;
  costPrice: string;
  shelfLifeMonths: string;
  ean: string;
  /** Said to have no barcode, so it is given one of the section's own. */
  noBarcode: boolean;
  systembolagetId: string;
  tags: string[];
};

const emptyDraft = (): Draft => ({
  name: "",
  kind: "UNIT",
  category: "OL",
  abv: "",
  unitMl: "",
  nominalMl: "",
  costPrice: "",
  shelfLifeMonths: "",
  ean: "",
  noBarcode: false,
  systembolagetId: "",
  tags: [],
});

const draftOf = (p: StockProductDto): Draft => ({
  name: p.name,
  kind: p.kind,
  category: p.category,
  abv: p.abv?.toString() ?? "",
  unitMl: p.unitMl?.toString() ?? "",
  nominalMl: p.nominalMl?.toString() ?? "",
  costPrice: p.costPriceOre != null ? (p.costPriceOre / 100).toString() : "",
  shelfLifeMonths: p.shelfLifeMonths?.toString() ?? "",
  ean: p.ean ?? "",
  noBarcode: isInternalCode(p.ean),
  systembolagetId: p.systembolagetId ?? "",
  tags: p.tags,
});

/** Empty means "not stated", which is a different thing from zero. */
const num = (s: string): number | undefined => {
  const trimmed = s.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};
const int = (s: string): number | undefined => {
  const n = num(s);
  return n == null ? undefined : Math.round(n);
};

export function ProductDialog({
  product,
  name,
  ean,
  knownTags = [],
  onClose,
  onCreated,
}: {
  product: StockProductDto | null;
  /** A name to start from, for a product being invented mid-sheet. */
  name?: string;
  /** A barcode to start from, for one invented by scanning an unknown code. */
  ean?: string;
  /** The tags other products already carry, offered in the picker. Handed in because every opening screen already holds the products. */
  knownTags?: string[];
  onClose: () => void;
  /** Told the id of a product this dialog has just made, for a caller that wants to carry on with it. */
  onCreated?: (id: string) => void;
}) {
  const t = useTranslations("stock");
  const { pending, mutate } = useMutation();
  const [scanning, setScanning] = useState(false);
  const [d, setD] = useState<Draft>(
    product ? draftOf(product) : { ...emptyDraft(), name: name ?? "", ean: ean ?? "" },
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  // Asked before a product is taken as having no barcode (see the box under the barcode field).
  const [askingNoBarcode, setAskingNoBarcode] = useState(false);
  const ownCode = product && isInternalCode(product.ean) ? product.ean : null;

  const isVolume = d.kind === "VOLUME";

  /** The tags on offer: the rest of the shelf's, less what this product already carries (those are the chips above the picker). */
  const tagOptions = cleanTags(knownTags).filter((tag) => !hasTag(d.tags, tag));
  const tagsFull = d.tags.length >= MAX_TAGS;
  // The route refuses a longer tag, so the offer says so instead of doing nothing when pressed.
  const tooLong = (text: string) => text.trim().length > MAX_TAG;

  /** Picked from the list or typed; a tag the product already carries, however spelled, is not a second tag. */
  const addTag = (text: string) => {
    if (tagsFull || tooLong(text) || hasTag(d.tags, text)) return;
    set("tags", cleanTags([...d.tags, text]));
  };

  // The article number is optional, but something typed that is not one is a mistake worth stopping.
  const sbFault =
    d.systembolagetId.trim() !== "" && parseSystembolagetId(d.systembolagetId) === null;

  /**
   * What is still missing before this is a product. Required: a barcode (scanning registers stock), strength and size
   * (the restaurangrapport is litres and pure alcohol), a cost (the shelf's value), and for a spirit the bottle size
   * (its rungs are fractions of it). Mirrors the route's rule, so the button is never live for something the server rejects.
   */
  const blockerFault =
    d.name.trim() === ""
      ? "nameRequired"
      : !d.noBarcode && d.ean.trim() === ""
        ? "eanRequired"
        : !d.noBarcode && !validGtin(d.ean)
          ? "eanInvalid"
          : !d.noBarcode && isInternalCode(d.ean) && d.ean.trim() !== ownCode
            ? "internalCodeTyped"
            : num(d.abv) == null
              ? "abvRequired"
              : isVolume && !int(d.nominalMl)
                ? "calibrationNoVolume"
                : !isVolume && !int(d.unitMl)
                  ? "sizeRequired"
                  : num(d.costPrice) == null
                    ? "costRequired"
                    : null;

  /** Why the save button is dead, in one sentence, or null. Shown for every product kind so an empty box is never unexplained. */
  const blocker = blockerFault
    ? t(`fault.${blockerFault}`)
    : sbFault
      ? t("products.field.systembolagetIdInvalid")
      : null;

  async function save() {
    const body: CreateStockProduct = {
      name: d.name.trim(),
      kind: d.kind,
      category: d.category,
      // The button is dead until `blocker` is null, so the fallbacks below are for the compiler.
      abv: num(d.abv) ?? 0,
      unitMl: isVolume ? null : (int(d.unitMl) ?? null),
      nominalMl: isVolume ? (int(d.nominalMl) ?? null) : null,
      costPriceOre: Math.round((num(d.costPrice) ?? 0) * 100),
      // Null, not undefined, when cleared: undefined in a PATCH means "leave it alone".
      shelfLifeMonths: int(d.shelfLifeMonths) || null,
      // Said to have none: the route gives it the section's own (or keeps the one it has), so nothing is sent for the field.
      ean: d.noBarcode ? undefined : d.ean.trim(),
      noBarcode: d.noBarcode || undefined,
      // Reduced to the article number (the route takes only digits). Null clears the column, undefined leaves it alone in a PATCH.
      systembolagetId: parseSystembolagetId(d.systembolagetId),
      // Always sent, empty list included: on a PATCH that takes the last tag off.
      tags: d.tags,
    };
    const saved = await mutate<{ id: string }>(
      product ? `/api/stock/products/${product.id}` : "/api/stock/products",
      {
        method: product ? "PATCH" : "POST",
        body,
        error: t("products.saveFailed"),
        success: t("products.saved"),
      },
    );
    if (saved === null) return;
    if (!product && saved.id) onCreated?.(saved.id);
    onClose();
  }

  return (
    <Modal label={t("products.new")} onClose={onClose} className="max-w-lg">
      <ModalHeader
        title={product ? product.name : t("products.new")}
        subtitle={t("products.dialogHint")}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        <Field label={t("products.field.name")} requirement="required">
          <Input value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </Field>

        {/* FieldGroup, not Field: a <label> forwards a click to the first labelable element, so tapping the scanner would open the keyboard. */}
        {/* A barcode, or the product said to have none (a keg has none). Choosing "none" asks once more first; the check digit (lib/stock/barcode.ts) stops made-up numbers. */}
        {d.noBarcode ? (
          <FieldGroup label={t("products.field.ean")}>
            <p className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-muted">
              {ownCode ? t("barcode.ownCode", { code: ownCode }) : t("barcode.willGetOwn")}
            </p>
          </FieldGroup>
        ) : (
          <FieldGroup
            label={t("products.field.ean")}
            hint={t("products.field.eanHint")}
            requirement="required"
          >
            <SuffixedInput
              inputMode="numeric"
              // An unnamed numeric box wanting thirteen digits looks like a card number to password managers.
              // `autoComplete="off"` is often ignored, so 1Password's own opt-out is set too.
              name="product-ean"
              autoComplete="off"
              data-1p-ignore
              value={d.ean}
              onChange={(e) => set("ean", e.target.value.replace(/[^0-9]/g, ""))}
              inputClassName="tabular-nums"
              placeholder="7312040017072"
              aria-label={t("products.field.ean")}
              // The box gives up its right padding for the button, which gives up its vertical margin so the field keeps its neighbours' height.
              className="pr-1"
              suffix={
                <IconButton
                  label={t("scan.action")}
                  title={t("scan.action")}
                  onClick={() => setScanning(true)}
                  className="-my-1.5"
                >
                  <IconScan className="size-5" />
                </IconButton>
              }
            />
          </FieldGroup>
        )}
        <div className="-mt-2 space-y-2">
          <Checkbox
            checked={d.noBarcode || askingNoBarcode}
            onChange={() => {
              if (!(d.noBarcode || askingNoBarcode)) setAskingNoBarcode(true);
              else {
                setAskingNoBarcode(false);
                // Back to typing one: the section's own code would be refused as typed.
                setD((p) => ({
                  ...p,
                  noBarcode: false,
                  ean: isInternalCode(p.ean) ? "" : p.ean,
                }));
              }
            }}
            label={t("barcode.none")}
          >
            {t("barcode.none")}
          </Checkbox>
          {askingNoBarcode && !d.noBarcode && (
            <div className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm">
              <p>{t("barcode.confirm")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    set("noBarcode", true);
                    setAskingNoBarcode(false);
                  }}
                >
                  {t("barcode.confirmYes")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAskingNoBarcode(false)}>
                  {t("barcode.confirmNo")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Takes a pasted product URL as well as the bare number (the number is only found on the product's page). Reduced to digits on save. */}
        <Field
          label={t("products.field.systembolagetId")}
          error={sbFault ? t("products.field.systembolagetIdInvalid") : undefined}
          requirement="optional"
        >
          <Input
            value={d.systembolagetId}
            onChange={(e) => set("systembolagetId", e.target.value)}
            placeholder="141215"
            className="tabular-nums"
          />
        </Field>

        {/* FieldGroup, not Field: a combobox trigger is a <button>, and a <label> would pop the menu open on a click beside it. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup
            label={t("products.field.kind")}
            hint={t(`kindHint.${d.kind}`)}
            requirement="required"
          >
            <Combobox
              value={d.kind}
              onChange={(v) => set("kind", v as StockKind)}
              options={KIND_OPTIONS.map((k) => ({
                value: k,
                label: t(`kindName.${k}`),
              }))}
              aria-label={t("products.field.kind")}
            />
          </FieldGroup>
          <FieldGroup label={t("products.field.category")} requirement="required">
            {/* A searchable field: long names like "Alkoholdrycksliknande preparat" make a native select a scroll. */}
            <Combobox
              value={d.category}
              onChange={(v) => set("category", v as DrinkCategory)}
              options={CATEGORIES.map((c) => ({
                value: c,
                label: t(`category.${c}`),
              }))}
              searchPlaceholder={t("products.field.categorySearch")}
              aria-label={t("products.field.category")}
            />
          </FieldGroup>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("products.field.abv")} requirement="required">
            {/* The unit is inside the box: the wrong reading (0,4 for 40 %) is a plausible number nothing downstream would question. */}
            <SuffixedInput
              value={d.abv}
              onChange={(e) => set("abv", e.target.value)}
              inputMode="decimal"
              placeholder="40"
              aria-label={t("products.field.abv")}
              inputClassName="tabular-nums"
              suffix={
                <span aria-hidden className="shrink-0 text-muted">
                  %
                </span>
              }
            />
          </Field>
          <Field label={t("products.field.cost")} requirement="required">
            <AmountInput value={d.costPrice} onChange={(v) => set("costPrice", v)} />
          </Field>
        </div>

        {isVolume ? (
          <>
            {/* The whole a level is a fraction of: a bottle is judged by eye at 80, 60, 40 or 20 per cent. */}
            <Field label={t("products.field.nominalMl")} requirement="required">
              <Input
                value={d.nominalMl}
                onChange={(e) => set("nominalMl", e.target.value)}
                inputMode="numeric"
              />
            </Field>
          </>
        ) : (
          <Field label={t("products.field.unitMl")} requirement="required">
            <Input
              value={d.unitMl}
              onChange={(e) => set("unitMl", e.target.value)}
              inputMode="numeric"
            />
          </Field>
        )}

        {/* Shelf life in months. Optional: a spirit does not go off, and empty raises no checks. See lib/stock/expiry.ts. */}
        <Field
          label={t("products.field.shelfLife")}
          hint={t("products.field.shelfLifeHint")}
          requirement="optional"
        >
          <Input
            value={d.shelfLifeMonths}
            onChange={(e) => set("shelfLifeMonths", e.target.value)}
            inputMode="numeric"
            placeholder={t("products.field.shelfLifePlaceholder")}
          />
        </Field>

        {/* Last: a tag is how a product is found afterwards. FieldGroup, not Field: it labels a row of chips and a picker. */}
        <FieldGroup
          label={t("products.field.tags")}
          hint={t("products.field.tagsHint")}
          requirement="optional"
        >
          <div className="space-y-2">
            <TagChips
              tags={d.tags}
              onRemove={(tag) =>
                set(
                  "tags",
                  d.tags.filter((x) => x !== tag),
                )
              }
              removeLabel={(tag) => t("products.field.tagRemove", { tag })}
            />
            {/* A picker that also invents. Resets to empty after each pick, since it holds the next thing to add. */}
            <Combobox
              value=""
              onChange={addTag}
              options={tagOptions.map((tag) => ({ value: tag, label: tag }))}
              onCreate={addTag}
              createLabel={(text) =>
                tooLong(text)
                  ? t("products.field.tagTooLong", { max: MAX_TAG })
                  : t("products.field.tagCreate", { tag: text })
              }
              placeholder={
                tagsFull
                  ? t("products.field.tagsFull", { max: MAX_TAGS })
                  : t("products.field.tagAdd")
              }
              searchPlaceholder={t("products.field.tagSearch")}
              emptyText={t("products.field.tagsNone")}
              disabled={tagsFull}
              aria-label={t("products.field.tags")}
            />
          </div>
        </FieldGroup>
      </div>

      {/* The reason travels with the button. See ModalFooter. */}
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

      {scanning && (
        <BarcodeScanner
          onCode={(code) => {
            set("ean", code);
            setScanning(false);
          }}
          onCancel={() => setScanning(false)}
        />
      )}
    </Modal>
  );
}
