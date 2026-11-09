"use client";

// One dialog for both jobs: `item` is null when adding and a row when editing (same shape as the stock ProductDialog).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Field, Input, Textarea } from "@/components/ui/field";
import { AmountInput } from "@/components/ui/amount-input";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { oreToSEK, parseOre, sekToInput } from "@/lib/domain/money";
import type { RentalItemRow } from "@/lib/data/rental-items";

/** Öre to the string the amount field holds. */
const fromOre = (ore: number | null) => (ore === null ? "" : sekToInput(oreToSEK(ore)));

export function ItemDialog({
  item,
  onClose,
}: {
  /** Null to add one. */
  item: RentalItemRow | null;
  onClose: () => void;
}) {
  const t = useTranslations("contracts.items");
  const confirm = useConfirm();
  const { mutate, pending } = useMutation();

  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [dailyPrice, setDailyPrice] = useState(fromOre(item?.dailyPriceOre ?? null));
  const [replacement, setReplacement] = useState(item ? fromOre(item.replacementValueOre) : "");

  const count = Number(quantity);

  // One expression disables the button and says why, so they cannot disagree.
  const blocker =
    name.trim() === ""
      ? t("blocker.name")
      : replacement.trim() === ""
        ? t("blocker.replacementValue")
        : !Number.isInteger(count) || count < 1
          ? t("blocker.quantity")
          : null;

  const body = {
    name: name.trim(),
    description: description.trim() || null,
    quantity: count,
    // Blank means "priced case by case", not zero (a zero would print "0,00 kr per dag").
    dailyPriceOre: dailyPrice.trim() === "" ? null : parseOre(dailyPrice),
    replacementValueOre: parseOre(replacement),
  };

  async function save() {
    const saved = item
      ? await mutate(`/api/rental-items/${item.id}`, {
          method: "PATCH",
          body,
          key: "save",
          success: t("saved"),
        })
      : await mutate("/api/rental-items", { body, key: "save", success: t("added") });
    if (saved !== null) onClose();
  }

  async function remove() {
    if (!item) return;
    const ok = await confirm({
      title: t("remove"),
      message: t("removeConfirm", { name: item.name }),
      tone: "danger",
    });
    if (!ok) return;
    const gone = await mutate(`/api/rental-items/${item.id}`, {
      method: "DELETE",
      key: "remove",
    });
    if (gone !== null) onClose();
  }

  return (
    <Modal label={item ? t("edit") : t("add")} onClose={onClose} className="max-w-lg">
      <ModalHeader
        title={item ? t("edit") : t("add")}
        subtitle={item && item.usedBy > 0 ? t("inUse", { count: item.usedBy }) : undefined}
      />
      <ModalBody>
        <div className="space-y-5">
          <Field label={t("name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("quantity")}>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label={t("dailyPrice")}>
              <AmountInput value={dailyPrice} onChange={setDailyPrice} suffix="kr" />
            </Field>
          </div>

          <Field label={t("replacementValue")} hint={t("replacementValueHint")}>
            <AmountInput value={replacement} onChange={setReplacement} suffix="kr" />
          </Field>

          <Field label={t("itemDescription")}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
          </Field>

          {item && item.usedBy > 0 && <p className="text-xs text-muted">{t("editSafe")}</p>}
        </div>
      </ModalBody>

      <ModalFooter blocker={blocker}>
        {item ? (
          <div className="flex items-center gap-2">
            <Button
              variant="dangerOutline"
              size="sm"
              loading={pending === "remove"}
              onClick={remove}
            >
              {t("remove")}
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={Boolean(blocker)} loading={pending === "save"}>
            {item ? t("save") : t("add")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
