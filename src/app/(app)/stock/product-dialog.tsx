"use client";

// The form a product is created and corrected in.
//
// Its own file because two screens open it: the list, for a new product, and a
// product's own page, for an existing one. It used to sit inside the list,
// which is where it lived when the list was the only place a product could be
// looked at.
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
  /** A barcode to start from, for one invented by scanning something the
   *  cellar has never seen. */
  ean?: string;
  /**
   * The tags other products already carry, offered in the picker.
   *
   * Handed in rather than fetched: every screen that opens this dialog is
   * already holding the products, so the vocabulary is there for the taking and
   * a request of its own would only ask the server what the page knows. A
   * caller with no products passes none, and then the only tags on offer are
   * the ones typed here.
   */
  knownTags?: string[];
  onClose: () => void;
  /** Told the id of a product this dialog has just made, for a caller that
   *  asked for one and wants to carry on with it. */
  onCreated?: (id: string) => void;
}) {
  const t = useTranslations("stock");
  const { pending, mutate } = useMutation();
  const [scanning, setScanning] = useState(false);
  const [d, setD] = useState<Draft>(
    product ? draftOf(product) : { ...emptyDraft(), name: name ?? "", ean: ean ?? "" },
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  // Asking whether it really has no barcode, before it is taken as having
  // none. See the box under the barcode field.
  const [askingNoBarcode, setAskingNoBarcode] = useState(false);
  const ownCode = product && isInternalCode(product.ean) ? product.ean : null;

  const isVolume = d.kind === "VOLUME";

  /**
   * The tags on offer: what the rest of the shelf says, less what this product
   * already carries.
   *
   * Off the list rather than crossed out on it, because the ones it carries are
   * the chips sitting directly above the picker. What is left is what there is
   * to add.
   */
  const tagOptions = cleanTags(knownTags).filter((tag) => !hasTag(d.tags, tag));
  const tagsFull = d.tags.length >= MAX_TAGS;
  // The route refuses one longer than this, so the offer to make it says so
  // instead of being a row that quietly does nothing when pressed.
  const tooLong = (text: string) => text.trim().length > MAX_TAG;

  /** Picked from the list or typed into it; both arrive here. A tag the product
   *  already carries, however it is spelled, is not a second tag. */
  const addTag = (text: string) => {
    if (tagsFull || tooLong(text) || hasTag(d.tags, text)) return;
    set("tags", cleanTags([...d.tags, text]));
  };

  // The article number is optional, so an empty box is fine. Something typed
  // that is not an article number is a mistake worth stopping, not worth
  // silently storing as nothing.
  const sbFault =
    d.systembolagetId.trim() !== "" && parseSystembolagetId(d.systembolagetId) === null;

  /**
   * What is still missing before this is a product.
   *
   * All of it is required, and each part for a reason the feature actually
   * depends on rather than for tidiness. A barcode, because scanning is how
   * stock gets registered and a product nobody can scan is one somebody types
   * thirteen digits to find. A strength and a size, because the restaurangrapport
   * is litres and pure alcohol, and a product missing either quietly leaves
   * itself out of the return. A cost, because the shelf's value is the sum of
   * what things cost and one unpriced product makes the total a guess. And for
   * a spirit the bottle size is what its rungs are fractions of. Without it
   * every level is worth nothing and a night's arithmetic comes to zero.
   *
   * Everything not on this list is optional and says so in its own hint: the
   * article number, the shelf life, the tags.
   *
   * The same rule the route refuses on, so the button is never live for
   * something the server would reject.
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

  /**
   * Why the save button is dead, in one sentence, or null when it is not.
   *
   * The sentence used to be drawn inside the branch that gives a spirit its
   * bottle size, so it was shown for a bottle of vodka and for nothing else. A
   * can of beer with no barcode yet had a dead button and no word anywhere
   * about which box was still empty, and filling in every empty box you can
   * see is a reasonable thing to do about that.
   */
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
      // The button is dead until `blocker` is null, and `blockerFault` is
      // exactly the check that these are all there, so the fallbacks below are
      // for the compiler rather than for anything that can happen.
      abv: num(d.abv) ?? 0,
      unitMl: isVolume ? null : (int(d.unitMl) ?? null),
      nominalMl: isVolume ? (int(d.nominalMl) ?? null) : null,
      costPriceOre: Math.round((num(d.costPrice) ?? 0) * 100),
      // Optional, and null rather than undefined when cleared: a product that
      // turns out not to go off has to be able to stop raising checks, and
      // undefined in a PATCH means "leave it alone".
      shelfLifeMonths: int(d.shelfLifeMonths) || null,
      // Said to have none: the route gives it the section's own (or keeps the
      // one it has), so nothing is sent for the field itself.
      ean: d.noBarcode ? undefined : d.ean.trim(),
      noBarcode: d.noBarcode || undefined,
      // Whatever was pasted, reduced to the article number. The route takes
      // only digits. Null rather than undefined so clearing the field clears
      // the column; undefined in a PATCH means "leave it alone".
      systembolagetId: parseSystembolagetId(d.systembolagetId),
      // Always sent, empty list included: on a PATCH that is what takes the
      // last tag off a product, and leaving the field out would mean "no
      // change" instead.
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

        {/* FieldGroup, not Field: the box holds a button as well as the input,
            and a <label> forwards a click anywhere in its area to the first
            labelable element inside it, which on a phone is the difference
            between tapping the scanner and opening the keyboard. */}
        {/* A barcode, or the product said outright to have none. Not an
            empty field the form lets past: a keg had no barcode, the field
            would not take nothing, and a made-up number went in. Now there is
            an honest way, and the check digit (lib/stock/barcode.ts) stops the
            made-up one. Choosing "none" asks once more first, so it is not the
            quick way past a barcode somebody could not be bothered to scan. */}
        {d.noBarcode ? (
          <FieldGroup label={t("products.field.ean")}>
            <p className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-muted">
              {ownCode
                ? t("barcode.ownCode", { code: ownCode })
                : t("barcode.willGetOwn")}
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
              // Named, and told outright that it is not a credential. The same
              // treatment the payout fields in Min profil needed, for the same
              // reason and one of its own: an unnamed numeric box that wants
              // thirteen digits is the shape of a card number, so a password
              // manager offers to fill one in. `autoComplete="off"` is the
              // standard half; managers routinely ignore it, so 1Password's own
              // opt-out says it again in the one language it does read. If
              // another manager starts guessing here, it will have an attribute
              // of its own to add beside this one.
              name="product-ean"
              autoComplete="off"
              data-1p-ignore
              value={d.ean}
              onChange={(e) => set("ean", e.target.value.replace(/[^0-9]/g, ""))}
              inputClassName="tabular-nums"
              placeholder="7312040017072"
              aria-label={t("products.field.ean")}
              // The box gives up its right padding so the button can sit near the
              // edge, and the button gives up its vertical margin so it does not
              // set the box's height, 32px of tappable button inside a field
              // that still measures the same as the ones above and below it.
              className="pr-1"
              suffix={
                /* Read it off the tin rather than off the tin and then into the
                   box. Thirteen digits copied by eye is the one part of making a
                   product that a machine does better. */
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={d.noBarcode || askingNoBarcode}
              onChange={(e) => {
                if (e.target.checked) setAskingNoBarcode(true);
                else {
                  setAskingNoBarcode(false);
                  // Back to typing one: the section's own code is not one to
                  // keep in the field, it would be refused as typed.
                  setD((p) => ({ ...p, noBarcode: false, ean: isInternalCode(p.ean) ? "" : p.ean }));
                }
              }}
              className="size-4 accent-[var(--color-accent)]"
            />
            {t("barcode.none")}
          </label>
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

        {/* Takes a pasted product URL as readily as the bare number: the number
            is only ever found on the product's page, so the address bar is what
            the person filling this in actually has. Reduced to digits on save.
            No hint saying so: the field is marked Frivilligt, the placeholder
            shows what a number looks like, and a paragraph under it repeating
            both was the longest thing on a form of short ones. */}
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

        {/* FieldGroup, not Field: a combobox's trigger is a <button>, and a
            <label> forwards a click anywhere in its box to the first labelable
            element inside it, so wrapping one in Field means clicking the
            empty space beside it pops the menu open. Field's own note says so.
          */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* The hint says what the choice means, which the two names alone
              do not: Styckvara is counted in whole things, Nivåvara in sealed
              bottles and how full the opened ones are. */}
          <FieldGroup
            label={t("products.field.kind")}
            hint={t(`kindHint.${d.kind}`)}
            requirement="required"
          >
            <Combobox
              value={d.kind}
              onChange={(v) => set("kind", v as StockKind)}
              options={KIND_OPTIONS.map((k) => ({ value: k, label: t(`kindName.${k}`) }))}
              aria-label={t("products.field.kind")}
            />
          </FieldGroup>
          <FieldGroup label={t("products.field.category")} requirement="required">
            {/* Eight drink types with names like "Alkoholdrycksliknande
                preparat": long enough that a native select is a scroll, and
                exactly what a searchable field is for, type "sta" for
                starköl. */}
            <Combobox
              value={d.category}
              onChange={(v) => set("category", v as DrinkCategory)}
              options={CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))}
              searchPlaceholder={t("products.field.categorySearch")}
              aria-label={t("products.field.category")}
            />
          </FieldGroup>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("products.field.abv")} requirement="required">
            {/* The unit inside the box rather than in the label, because it is
                the one field where the wrong reading (0,4 for 40 %) is a
                plausible number that nothing downstream would question. */}
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
            {/* The whole a level is a fraction of. Nothing is weighed any more
                A bottle is judged by eye at 80, 60, 40 or 20 per cent, so
                this is all a spirit needs. */}
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

        {/* How long it keeps, which is a fact about the product and the only
            place one can live: nothing is written on the crates in this cellar,
            they get mixed on the shelf, and they come off it in whatever order
            somebody reaches. Months, because that is the unit the answer is
            known in. Nobody says a beer keeps 274 days.

            Optional, and meant to be: a spirit does not go off, and a product
            left empty here raises no checks at all rather than inheriting a
            default nobody believes. See lib/stock/expiry.ts. */}
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

        {/* Last: everything above the shelf life is what a product has to be
            before it can exist, and a tag is how somebody finds it afterwards.
            FieldGroup, not Field: what it labels is a row of chips and a
            picker, not one control. */}
        <FieldGroup
          label={t("products.field.tags")}
          hint={t("products.field.tagsHint")}
          requirement="optional"
        >
          <div className="space-y-2">
            <TagChips
              tags={d.tags}
              onRemove={(tag) => set("tags", d.tags.filter((x) => x !== tag))}
              removeLabel={(tag) => t("products.field.tagRemove", { tag })}
            />
            {/* A picker that also invents: the list is every tag the cellar
                already uses, so "whisky" is picked rather than typed a second
                time and spelled differently, and something genuinely new is
                offered as itself. Resets to empty after each pick, since what
                it holds is not a value but the next thing to add. */}
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

      {/* The reason travels with the button rather than sitting at the foot of
          a body you would have to scroll to reach. See ModalFooter. */}
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
