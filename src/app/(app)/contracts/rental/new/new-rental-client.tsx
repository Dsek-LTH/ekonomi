"use client";

// Drawing an uthyrningsavtal.
//
// One page rather than a wizard. An utlägg is filed in steps because each one
// waits on something (a receipt to arrive, a match to be found); a rental is a
// list of gear and two dates, all of which the person drawing it already knows,
// and stepping through four screens to say so would be four screens.
//
// The line editor picks from the catalogue and then lets the values be
// overridden. That is deliberate rather than a convenience: the catalogue is a
// suggestion and the contract is the agreement, so what ends up on the document
// is what somebody typed here, copied at this moment (see the RentalLine model).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput, Field, FieldGroup, Input, Textarea } from "@/components/ui/field";
import { AmountInput } from "@/components/ui/amount-input";
import { Amount } from "@/components/ui/amount";
import { EmptyNote } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { useMutation } from "@/components/shell/use-mutation";
import { oreToSEK, parseSEK } from "@/lib/domain/money";
import { isCompleteDate } from "@/lib/domain/date";
import type { RentalItemOption } from "@/lib/data/rental-items";

interface LineDraft {
  /** Local only, so React can key the rows. Never sent. */
  key: string;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  replacementValue: string;
}

const toOre = (input: string) => (input.trim() === "" ? 0 : Math.round(parseSEK(input) * 100));

const emptyLine = (): LineDraft => ({
  key: crypto.randomUUID(),
  itemId: null,
  description: "",
  quantity: "1",
  unitPrice: "",
  replacementValue: "",
});

export function NewRentalClient({
  items,
  knownTags,
  signatoryName,
}: {
  items: RentalItemOption[];
  knownTags: string[];
  signatoryName: string;
}) {
  const t = useTranslations("contracts");
  const router = useRouter();
  const { mutate, pending } = useMutation();

  const [title, setTitle] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [orgNo, setOrgNo] = useState("");
  const [pickupAt, setPickupAt] = useState("");
  const [returnAt, setReturnAt] = useState("");
  const [purpose, setPurpose] = useState("");
  const [place, setPlace] = useState("");
  const [price, setPrice] = useState("");
  const [deposit, setDeposit] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [signatoryTitle, setSignatoryTitle] = useState("");
  const [renterName, setRenterName] = useState("");
  const [renterEmail, setRenterEmail] = useState("");
  const [renterPhone, setRenterPhone] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Picking from the catalogue fills the row in. The values stay editable
  // afterwards, because a contract can let a speaker for less than the standing
  // price and still has to say what it would cost to replace.
  function pickItem(key: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setLine(key, {
      itemId: item.id,
      description: item.name,
      unitPrice: item.dailyPriceOre === null ? "" : (item.dailyPriceOre / 100).toFixed(2),
      replacementValue: (item.replacementValueOre / 100).toFixed(2),
    });
  }

  const filledLines = lines.filter((l) => l.description.trim() !== "");
  const totalReplacement = filledLines.reduce(
    (sum, l) => sum + toOre(l.replacementValue) * (Number(l.quantity) || 0),
    0,
  );

  const datesWhole = isCompleteDate(pickupAt) && isCompleteDate(returnAt);
  const datesOrdered = !datesWhole || returnAt >= pickupAt;
  const ready =
    title.trim() !== "" &&
    counterparty.trim() !== "" &&
    datesWhole &&
    datesOrdered &&
    filledLines.length > 0;

  async function create() {
    const created = await mutate<{ id: string; documentDrawn: boolean }>(
      "/api/contracts/rental",
      {
        body: {
          title: title.trim(),
          counterparty: counterparty.trim(),
          counterpartyOrgNo: orgNo.trim() || null,
          tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
          notes: notes.trim() || null,
          pickupAt,
          returnAt,
          purpose: purpose.trim() || null,
          place: place.trim() || null,
          priceOre: toOre(price),
          depositOre: toOre(deposit),
          lines: filledLines.map((l) => ({
            itemId: l.itemId,
            description: l.description.trim(),
            quantity: Number(l.quantity) || 1,
            unitPriceOre: toOre(l.unitPrice),
            replacementValueOre: toOre(l.replacementValue),
          })),
          sectionSignatoryTitle: signatoryTitle.trim() || null,
          counterpartySignatory: renterName.trim()
            ? {
                name: renterName.trim(),
                email: renterEmail.trim() || null,
                phone: renterPhone.trim() || null,
              }
            : undefined,
        },
        success: t("rental.created"),
        refresh: false,
      },
    );
    if (created) router.push(`/contracts/${created.id}`);
  }

  return (
    <PageShell
      title={t("rental.newTitle")}
      description={t("rental.newDescription")}
      width="content"
      back={{ href: "/contracts", label: t("detail.back") }}
    >
      <div className="space-y-5">
        {items.length === 0 && <Notice tone="warning">{t("rental.emptyCatalogue")}</Notice>}

        <Card>
          <CardBody className="space-y-5">
            <Field label={t("form.title")} hint={t("form.titleHint")}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("rental.counterparty")} hint={t("rental.counterpartyHint")}>
                <Input
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                  maxLength={200}
                />
              </Field>
              <Field label={t("form.counterpartyOrgNo")}>
                <Input value={orgNo} onChange={(e) => setOrgNo(e.target.value)} maxLength={40} />
              </Field>
              <Field label={t("rental.pickupAt")}>
                <DateInput value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} />
              </Field>
              <Field
                label={t("rental.returnAt")}
                error={datesOrdered ? undefined : t("rental.returnBeforePickup")}
              >
                <DateInput value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
              </Field>
              <Field label={t("rental.place")}>
                <Input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} />
              </Field>
              <Field label={t("rental.purpose")} hint={t("rental.purposeHint")}>
                <Input
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  maxLength={500}
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        {/* ── Utrustning ──────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title={t("rental.lines")}
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
              >
                <IconPlus className="size-4" />
                {t("rental.addLine")}
              </Button>
            }
          />
          <CardBody className="space-y-4">
            {lines.length === 0 ? (
              <EmptyNote>{t("rental.noLines")}</EmptyNote>
            ) : (
              lines.map((l) => (
                <div
                  key={l.key}
                  className="space-y-4 rounded-xl border border-dashed border-border p-4"
                >
                  {items.length > 0 && (
                    <FieldGroup label={t("rental.pickItem")}>
                      <Combobox
                        options={items.map((i) => ({ value: i.id, label: i.name }))}
                        value={l.itemId ?? ""}
                        onChange={(v) => pickItem(l.key, v)}
                        allowClear
                      />
                    </FieldGroup>
                  )}
                  <Field label={t("rental.description")}>
                    <Input
                      value={l.description}
                      onChange={(e) =>
                        // Typing over the description unlinks the catalogue row:
                        // the line is no longer the item it was drawn from, and
                        // keeping the id would claim a provenance it has lost.
                        setLine(l.key, { description: e.target.value, itemId: null })
                      }
                      maxLength={200}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={t("rental.quantity")}>
                      <Input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                      />
                    </Field>
                    <Field label={t("rental.unitPrice")}>
                      <AmountInput
                        value={l.unitPrice}
                        onChange={(v) => setLine(l.key, { unitPrice: v })}
                        suffix="kr"
                      />
                    </Field>
                    <Field label={t("rental.replacementValue")}>
                      <AmountInput
                        value={l.replacementValue}
                        onChange={(v) => setLine(l.key, { replacementValue: v })}
                        suffix="kr"
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="dangerOutline"
                      size="sm"
                      onClick={() =>
                        setLines((prev) => prev.filter((other) => other.key !== l.key))
                      }
                    >
                      <IconTrash className="size-4" />
                      {t("rental.removeLine")}
                    </Button>
                  </div>
                </div>
              ))
            )}

            <div className="flex justify-end gap-2 text-sm">
              <span className="text-muted">{t("rental.totalReplacement")}</span>
              <Amount value={oreToSEK(totalReplacement)} />
            </div>
          </CardBody>
        </Card>

        {/* ── Pengar och underskrifter ────────────────────────────── */}
        <Card>
          <CardBody className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("rental.price")}>
                <AmountInput value={price} onChange={setPrice} suffix="kr" />
              </Field>
              <Field label={t("rental.deposit")}>
                <AmountInput value={deposit} onChange={setDeposit} suffix="kr" />
              </Field>
            </div>

            <FieldGroup label={t("rental.sectionSignatory")}>
              <p className="mb-2 text-sm">{signatoryName}</p>
              <Input
                value={signatoryTitle}
                onChange={(e) => setSignatoryTitle(e.target.value)}
                placeholder={t("rental.sectionSignatoryTitle")}
                maxLength={120}
              />
            </FieldGroup>

            <FieldGroup label={t("rental.counterpartySignatory")}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  value={renterName}
                  onChange={(e) => setRenterName(e.target.value)}
                  placeholder={t("party.name")}
                  maxLength={120}
                />
                <Input
                  type="email"
                  value={renterEmail}
                  onChange={(e) => setRenterEmail(e.target.value)}
                  placeholder={t("party.email")}
                  maxLength={200}
                />
                <Input
                  value={renterPhone}
                  onChange={(e) => setRenterPhone(e.target.value)}
                  placeholder={t("party.phone")}
                  maxLength={40}
                />
              </div>
            </FieldGroup>

            <Field label={t("form.tags")} hint={t("form.tagsHint")}>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                list="rental-tags"
                autoComplete="off"
              />
            </Field>
            <datalist id="rental-tags">
              {knownTags.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>

            <Field label={t("form.notes")} hint={t("form.notesHint")}>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={4000}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => router.push("/contracts")}>
                {t("form.cancel")}
              </Button>
              <Button onClick={create} loading={pending !== null} disabled={!ready}>
                {t("rental.create")}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </PageShell>
  );
}
