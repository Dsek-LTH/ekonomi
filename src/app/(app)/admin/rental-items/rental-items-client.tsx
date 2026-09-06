"use client";

// Inställningar → Uthyrningsobjekt. The gear the section lets out, and what it
// costs to replace.
//
// The replacement value is the reason this screen exists. It is the figure the
// liability clause of an uthyrningsavtal points at, and before there was a
// catalogue it was whatever the person drawing the contract remembered, which
// meant the same speaker went out at three different values. Safe to edit for
// the same reason the mileage rates are: a rental line copies the values at the
// moment it is drawn, so nothing here re-prices a contract already signed.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyNote } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/field";
import { AmountInput } from "@/components/ui/amount-input";
import { Tag } from "@/components/ui/status-pill";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { Amount } from "@/components/ui/amount";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { oreToSEK, parseSEK } from "@/lib/domain/money";
import type { RentalItemRow } from "@/lib/data/rental-items";

export function RentalItemsClient({ items }: { items: RentalItemRow[] }) {
  const t = useTranslations("contracts.items");
  const confirm = useConfirm();
  const { mutate, pending } = useMutation();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dailyPrice, setDailyPrice] = useState("");
  const [replacement, setReplacement] = useState("");

  const toOre = (input: string) => Math.round(parseSEK(input) * 100);
  const ready = name.trim() !== "" && replacement.trim() !== "";

  async function add() {
    const saved = await mutate("/api/rental-items", {
      key: "new-item",
      body: {
        name: name.trim(),
        description: description.trim() || null,
        // Blank means "priced case by case", which is a real answer and not a
        // zero. A zero would print "0 kr per dag" on a contract.
        dailyPriceOre: dailyPrice.trim() === "" ? null : toOre(dailyPrice),
        replacementValueOre: toOre(replacement),
      },
      success: t("added"),
    });
    if (!saved) return;
    setName("");
    setDescription("");
    setDailyPrice("");
    setReplacement("");
    setAdding(false);
  }

  async function toggleActive(item: RentalItemRow) {
    await mutate(`/api/rental-items/${item.id}`, {
      method: "PATCH",
      body: { active: !item.active },
      key: item.id,
      success: t("saved"),
    });
  }

  async function remove(item: RentalItemRow) {
    const ok = await confirm({
      title: t("remove"),
      message: t("removeConfirm", { name: item.name }),
      tone: "danger",
    });
    if (!ok) return;
    // An item a contract points at comes back as retired rather than deleted.
    // The route decides that, not this screen; the message it returns is what
    // the reader is told.
    await mutate(`/api/rental-items/${item.id}`, { method: "DELETE", key: item.id });
  }

  return (
    <Card>
      <CardHeader
        title={t("title")}
        action={
          <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>
            <IconPlus className="size-4" />
            {adding ? t("save") : t("add")}
          </Button>
        }
      />
      <CardBody className="space-y-5">
        {adding && (
          <div className="space-y-4 rounded-xl border border-dashed border-border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("name")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              </Field>
              <Field label={t("replacementValue")} hint={t("replacementValueHint")}>
                <AmountInput value={replacement} onChange={setReplacement} suffix="kr" />
              </Field>
              <Field label={t("dailyPrice")} hint={t("dailyPriceHint")}>
                <AmountInput value={dailyPrice} onChange={setDailyPrice} suffix="kr" />
              </Field>
            </div>
            <Field label={t("itemDescription")}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
              />
            </Field>
            <div className="flex justify-end">
              <Button size="sm" onClick={add} loading={pending === "new-item"} disabled={!ready}>
                {t("add")}
              </Button>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <EmptyNote>{t("emptyDescription")}</EmptyNote>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{item.name}</span>
                    {!item.active && <Tag>{t("retire")}</Tag>}
                    {item.usedBy > 0 && <Tag>{t("inUse", { count: item.usedBy })}</Tag>}
                  </span>
                  {item.description && (
                    <span className="block truncate text-xs text-muted">{item.description}</span>
                  )}
                </span>

                <span className="text-right text-xs text-muted">
                  <span className="block">
                    {t("replacementValue")}{" "}
                    <Amount value={oreToSEK(item.replacementValueOre)} />
                  </span>
                  {item.dailyPriceOre !== null && (
                    <span className="block">
                      {t("dailyPrice")} <Amount value={oreToSEK(item.dailyPriceOre)} />
                    </span>
                  )}
                </span>

                <Button
                  variant="secondary"
                  size="sm"
                  loading={pending === item.id}
                  onClick={() => toggleActive(item)}
                >
                  {item.active ? t("retire") : t("restore")}
                </Button>
                <Button
                  variant="dangerOutline"
                  size="sm"
                  loading={pending === item.id}
                  onClick={() => remove(item)}
                >
                  <IconTrash className="size-4" />
                  <span className="sr-only">{t("remove")}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
