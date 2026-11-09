"use client";

// Drawing an uthyrningsavtal: the only place a contract comes into being (contracts/upload files ones signed elsewhere).
// Blocks: the two parties, when, and what for how much. The section does not sign its own rentals (see rental-contract.typ),
// so there is no signatory to pick (lib/contract/signatory.ts). Widths are container queries: the panel beside this form
// can be dragged. Also the edit screen: contracts/[id]/edit passes the contract as `existing`.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput, Field, FieldGroup, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { IconPlus } from "@/components/ui/icons";
import { useMutation } from "@/components/shell/use-mutation";
import { useLocalDraft } from "@/lib/ui/use-local-draft";
import { isCompleteDate } from "@/lib/domain/date";
import { Amount } from "@/components/ui/amount";
import { oreToSEK, parseOre, sekToInput } from "@/lib/domain/money";
import { rentalPricing } from "@/lib/contract/rental/pricing";
import { SECTION } from "@/lib/contract/section";
import { MAX_SIGNATURES } from "@/lib/api/schemas/contract";
import {
  RentalLines,
  makeLine,
  isBlankLineRow,
  effectiveDiscountPercent,
  type LineRow,
} from "./rental-lines";
import { CounterpartyDialog } from "../../counterparties/counterparty-dialog";
import type { RentalItemOption } from "@/lib/data/rental-items";
import type { Availability } from "@/lib/data/rental-availability";
import type { CounterpartyOption } from "@/lib/data/counterparties";
import type { ContractDetail, RentalLineRow } from "@/lib/data/contracts";

const toOre = (input: string) => (input.trim() === "" ? 0 : parseOre(input));
const kr = (ore: number) => sekToInput(oreToSEK(ore));

/** A stored line as the sheet holds it: strings, as if it had been typed. */
const lineFromRow = (l: RentalLineRow): LineRow => ({
  ...makeLine(),
  itemId: l.itemId,
  description: l.description,
  quantity: String(l.quantity),
  unitPrice: kr(l.unitPriceOre),
  discount: l.discountPercent > 0 ? String(l.discountPercent) : "",
  replacementValue: kr(l.replacementValueOre),
});

/** Everything typed into the form, as one value, so it can be kept as a draft. */
type RentalForm = {
  counterpartyId: string | null;
  statedCounterparty: string;
  orgNo: string;
  address: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  /** As typed, so a half-cleared field survives a reload as it was. */
  signatureCount: string;
  pickupAt: string;
  returnAt: string;
  purpose: string;
  lines: LineRow[];
};

/** Its own key, so a draft cannot be read back onto a different screen. */
const DRAFT_KEY = "contracts:rental:new:draft";

export function NewRentalClient({
  items,
  counterparties,
  existing,
}: {
  items: RentalItemOption[];
  counterparties: CounterpartyOption[];
  /** The rental being edited. Absent when drawing a new one. */
  existing?: ContractDetail;
}) {
  const t = useTranslations("contracts");
  const tc = useTranslations("contracts.counterparties");
  const router = useRouter();
  const { mutate, pending } = useMutation();

  // Everything typed is kept in localStorage while a new rental is drawn (lib/ui/use-local-draft.ts). Editing keeps plain
  // state: the server holds that one and a stale local copy would put old terms back.
  const [form, setForm, , forgetDraft] = useLocalDraft<RentalForm>(
    DRAFT_KEY,
    {
      counterpartyId: existing?.counterpartyId ?? null,
      // The renter's name as an edited contract states it when there is no directory row (older or deleted). Kept until another is picked.
      statedCounterparty:
        existing && !counterparties.some((c) => c.id === existing.counterpartyId)
          ? (existing.counterparty ?? "")
          : "",
      orgNo: existing?.counterpartyOrgNo ?? "",
      address: existing?.counterpartyAddress ?? "",
      postalCode: existing?.counterpartyPostalCode ?? "",
      city: existing?.counterpartyCity ?? "",
      email: existing?.counterpartyEmail ?? "",
      phone: existing?.counterpartyPhone ?? "",
      signatureCount: String(existing?.rental?.signatureCount ?? 1),
      pickupAt: existing?.rental?.pickupAt.slice(0, 10) ?? "",
      returnAt: existing?.rental?.returnAt.slice(0, 10) ?? "",
      purpose: existing?.rental?.purpose ?? "",
      // Utrustning och pengar. No money field: every figure below the lines is worked out (rental/pricing.ts).
      lines: existing?.rental ? existing.rental.lines.map(lineFromRow) : [makeLine()],
    },
    !existing,
  );
  const {
    counterpartyId,
    statedCounterparty,
    orgNo,
    address,
    postalCode,
    city,
    email,
    phone,
    signatureCount,
    pickupAt,
    returnAt,
    purpose,
    lines,
  } = form;
  const field =
    <K extends keyof RentalForm>(key: K) =>
    (value: RentalForm[K]) =>
      setForm((f) => ({ ...f, [key]: value }));
  const setCounterpartyId = field("counterpartyId");
  const setStatedCounterparty = field("statedCounterparty");
  const setOrgNo = field("orgNo");
  const setAddress = field("address");
  const setPostalCode = field("postalCode");
  const setCity = field("city");
  const setEmail = field("email");
  const setPhone = field("phone");
  const setSignatureCount = field("signatureCount");
  const setPickupAt = field("pickupAt");
  const setReturnAt = field("returnAt");
  const setPurpose = field("purpose");
  // Stable, because the sheet tops up its spare rows from an effect that lists
  // its `onChange` as a dependency.
  const setLines = useCallback(
    (rows: LineRow[]) => setForm((f) => ({ ...f, lines: rows })),
    [setForm],
  );

  // Hyrestagaren is picked from the directory (as in upload-client.tsx).
  const [counterpartyOptions, setCounterpartyOptions] = useState(counterparties);
  const [newCounterpartyName, setNewCounterpartyName] = useState<string | null>(null);
  const counterparty =
    counterpartyOptions.find((c) => c.id === counterpartyId)?.name ?? statedCounterparty;
  const signatures = Number(signatureCount);
  const signaturesValid =
    Number.isInteger(signatures) && signatures >= 1 && signatures <= MAX_SIGNATURES;

  // The renter's particulars, copied from the directory row on pick (blanked when cleared); shared by the picker and create-on-the-spot.
  function takeCounterparty(c: CounterpartyOption | undefined) {
    setStatedCounterparty("");
    setCounterpartyId(c?.id ?? null);
    setOrgNo(c?.orgNo ?? "");
    setAddress(c?.address ?? "");
    setPostalCode(c?.postalCode ?? "");
    setCity(c?.city ?? "");
    setEmail(c?.email ?? "");
    setPhone(c?.phone ?? "");
  }

  function pickCounterparty(id: string) {
    takeCounterparty(counterpartyOptions.find((c) => c.id === id));
  }

  function counterpartyCreated(created: CounterpartyOption) {
    setCounterpartyOptions((prev) => [...prev, created]);
    takeCounterparty(created);
    setNewCounterpartyName(null);
  }

  // What is free over the chosen period, stamped with the dates it was fetched for and read back only while they match.
  const [fetched, setFetched] = useState<
    { from: string; to: string; rows: Map<string, Availability> } | undefined
  >(undefined);

  const periodReady = isCompleteDate(pickupAt) && isCompleteDate(returnAt) && returnAt >= pickupAt;

  const free =
    periodReady && fetched?.from === pickupAt && fetched.to === returnAt ? fetched.rows : undefined;

  useEffect(() => {
    if (!periodReady) return;
    const abort = new AbortController();
    // An edited rental's own lines would otherwise count against it.
    const exclude = existing ? `&exclude=${existing.id}` : "";
    fetch(`/api/rental-items/availability?from=${pickupAt}&to=${returnAt}${exclude}`, {
      signal: abort.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: Availability[]) =>
        setFetched({
          from: pickupAt,
          to: returnAt,
          rows: new Map(rows.map((a) => [a.itemId, a])),
        }),
      )
      // A failed check shows nothing rather than "all free"; the create route checks again server-side.
      .catch(() => undefined);
    return () => abort.abort();
  }, [pickupAt, returnAt, periodReady, existing]);

  /** What is left of an item, counting what this form has already claimed on its other lines. */
  const freeFor = (itemId: string, exceptId: string): number | undefined => {
    const a = free?.get(itemId);
    if (!a) return undefined;
    const claimed = lines
      .filter((l) => l.id !== exceptId && l.itemId === itemId)
      .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
    return Math.max(0, a.free - claimed);
  };

  const filled = lines.filter((l) => !isBlankLineRow(l));
  const totalReplacementOre = filled.reduce(
    (s, l) => s + toOre(l.replacementValue) * (Number(l.quantity) || 0),
    0,
  );

  // The same function the create route runs, so screen and database cannot disagree.
  const pricing = rentalPricing(
    filled.map((l) => ({
      quantity: Number(l.quantity) || 0,
      unitPriceOre: toOre(l.unitPrice),
      discountPercent: effectiveDiscountPercent(l, toOre),
    })),
  );
  /** Every line off at 100 per cent (a free loan). Always percent, whatever a line's discount is typed as. */
  const lendFree = () =>
    setLines(lines.map((l) => ({ ...l, discount: "100", discountUnit: "percent" })));

  const datesOrdered =
    !isCompleteDate(pickupAt) || !isCompleteDate(returnAt) || returnAt >= pickupAt;
  const anyShort = lines.some((l) => {
    if (!l.itemId) return false;
    const left = freeFor(l.itemId, l.id);
    return left !== undefined && (Number(l.quantity) || 0) > left;
  });

  const ready =
    counterparty.trim() !== "" &&
    signaturesValid &&
    orgNo.trim() !== "" &&
    address.trim() !== "" &&
    postalCode.trim() !== "" &&
    city.trim() !== "" &&
    purpose.trim() !== "" &&
    periodReady &&
    filled.length > 0 &&
    !anyShort;

  // The panel shows the contract through the same builder and template as the saved one, keyed on exactly the fields the
  // document prints so unrelated keystrokes do not redraw it.
  const draft = {
    counterparty: counterparty.trim(),
    counterpartyOrgNo: orgNo.trim(),
    counterpartyAddress: address.trim(),
    counterpartyPostalCode: postalCode.trim(),
    counterpartyCity: city.trim(),
    pickupAt: isCompleteDate(pickupAt) ? pickupAt : null,
    returnAt: isCompleteDate(returnAt) ? returnAt : null,
    purpose: purpose.trim(),
    lines: filled.map((l) => ({
      description: l.description.trim(),
      quantity: Number(l.quantity) || 0,
      unitPriceOre: toOre(l.unitPrice),
      discountPercent: effectiveDiscountPercent(l, toOre),
      replacementValueOre: toOre(l.replacementValue),
    })),
    counterpartyEmail: email.trim(),
    counterpartyPhone: phone.trim(),
    // One block while the field is half typed, rather than no preview at all.
    signatureCount: signaturesValid ? signatures : 1,
  };
  const draftKey = JSON.stringify(draft);

  const [preview, setPreview] = useState<string | null>(null);
  // Revoked when replaced and on unmount: a new rendering is produced every few seconds.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    const abort = new AbortController();
    // Debounce: typing a sentence is one render, not fifteen.
    const timer = setTimeout(() => {
      fetch("/api/contracts/rental/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: draftKey,
        signal: abort.signal,
      })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((blob) => setPreview(URL.createObjectURL(blob)))
        // A preview that fails leaves the last one standing; the real document is drawn on save.
        .catch(() => undefined);
    }, 600);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
    // The draft's contents, not its identity (a new object every render would redraw forever).
  }, [draftKey]);

  async function save() {
    const body = {
      counterparty: draft.counterparty,
      counterpartyOrgNo: draft.counterpartyOrgNo,
      counterpartyAddress: draft.counterpartyAddress,
      counterpartyPostalCode: draft.counterpartyPostalCode,
      counterpartyCity: draft.counterpartyCity,
      counterpartyId,
      pickupAt,
      returnAt,
      purpose: purpose.trim(),
      // No rent is sent: the route runs the same pricing over the lines.
      lines: filled.map((l) => ({
        itemId: l.itemId,
        description: l.description.trim(),
        quantity: Number(l.quantity) || 1,
        unitPriceOre: toOre(l.unitPrice),
        discountPercent: effectiveDiscountPercent(l, toOre),
        replacementValueOre: toOre(l.replacementValue),
      })),
      counterpartyEmail: email.trim() || null,
      counterpartyPhone: phone.trim() || null,
      signatureCount: signatures,
    };

    // An edit sends the whole form again; the route replaces the contract and redraws the document.
    if (existing) {
      const saved = await mutate(`/api/contracts/${existing.id}/rental`, {
        method: "PUT",
        body,
        success: t("rental.saved"),
        refresh: false,
      });
      if (saved !== null) router.push(`/contracts/${existing.id}`);
      return;
    }

    const created = await mutate<{ id: string }>("/api/contracts/rental", {
      body,
      success: t("rental.created"),
      refresh: false,
    });
    if (created) {
      // Only the stored copy goes, so the form does not blank in the frame before the page changes.
      forgetDraft();
      router.push(`/contracts/${created.id}`);
    }
  }

  return (
    <PageShell
      title={existing ? t("rental.editTitle") : t("rental.newTitle")}
      width="content"
      back={existing ? `/contracts/${existing.id}` : "/rentals"}
    >
      {/* The contract beside the form. No `onFile`: the document is drawn, not attached. */}
      <ReceiptPanelSource
        previewUrl={preview}
        mimeType="application/pdf"
        filename={t("rental.documentName")}
        emptyTitle={t("rental.documentTitle")}
        emptyDescription={t("rental.documentPending")}
      />

      <div className="space-y-5">
        {items.length === 0 && <Notice tone="warning">{t("rental.emptyCatalogue")}</Notice>}

        {/* ── Parterna, side by side ───────────────────────────── */}
        {/* The parties share a row in the shape the document draws them; our side is shown but cannot be typed over. */}
        <Card>
          <CardHeader title={t("rental.parties")} subtitle={t("rental.counterpartyHint")} />
          <CardBody className="@container">
            <div className="grid gap-x-8 gap-y-6 @3xl:grid-cols-2">
              {/* ── Uthyraren ───────────────────────────────────── */}
              <div className="@container space-y-4">
                <h3 className="text-[13px] font-medium text-foreground">{t("rental.lessor")}</h3>

                {/* Static text, not disabled inputs: it is not a question. */}
                <div className="space-y-0.5 rounded-control bg-surface px-4 py-3 text-sm">
                  <p className="font-medium">{SECTION.name}</p>
                  {SECTION.orgNo && (
                    <p className="text-muted">
                      {t("rental.lessorOrgNo")} {SECTION.orgNo}
                    </p>
                  )}
                  {SECTION.address && <p className="text-muted">{SECTION.address}</p>}
                  {SECTION.postalLine && <p className="text-muted">{SECTION.postalLine}</p>}
                </div>
                <p className="text-xs text-muted">{t("rental.lessorFixed")}</p>
              </div>

              {/* ── Hyrestagaren ────────────────────────────────── */}
              {/* Its own container, so the grids below measure this column rather than the card. */}
              <div className="@container space-y-4">
                <h3 className="text-[13px] font-medium text-foreground">
                  {t("rental.counterparty")}
                </h3>

                <div className="grid gap-4 @md:grid-cols-[2fr_1fr]">
                  <FieldGroup
                    label={t("rental.renterOrg")}
                    requirement="required"
                    action={
                      <Button
                        variant="link"
                        type="button"
                        onClick={() => setNewCounterpartyName("")}
                        className="flex items-center gap-1 text-xs"
                      >
                        <IconPlus className="size-3.5" />
                        {tc("add")}
                      </Button>
                    }
                  >
                    <Combobox
                      options={counterpartyOptions.map((c) => ({
                        value: c.id,
                        label: c.name,
                      }))}
                      value={counterpartyId ?? ""}
                      onChange={pickCounterparty}
                      allowClear
                      placeholder={statedCounterparty || tc("pick")}
                      searchPlaceholder={tc("pick")}
                      onCreate={(text) => setNewCounterpartyName(text)}
                      createLabel={(text) => tc("createNew", { text })}
                      aria-label={t("rental.renterOrg")}
                    />
                  </FieldGroup>
                  {/* One field for organisationsnummer and personnummer. Required here (a rental may need enforcing), optional in the archive. */}
                  <Field label={t("rental.renterOrgNo")} requirement="required">
                    <Input
                      value={orgNo}
                      onChange={(e) => setOrgNo(e.target.value)}
                      maxLength={40}
                    />
                  </Field>
                </div>

                <Field label={t("rental.renterAddress")} requirement="required">
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    autoComplete="street-address"
                    maxLength={200}
                  />
                </Field>
                <div className="grid gap-4 @md:grid-cols-[1fr_2fr]">
                  <Field label={t("rental.renterPostalCode")} requirement="required">
                    <Input
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      autoComplete="postal-code"
                      inputMode="numeric"
                      maxLength={20}
                    />
                  </Field>
                  <Field label={t("rental.renterCity")} requirement="required">
                    <Input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      autoComplete="address-level2"
                      maxLength={100}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 @md:grid-cols-2">
                  <Field label={t("party.email")} requirement="optional">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      maxLength={200}
                    />
                  </Field>
                  <Field label={t("party.phone")} requirement="optional">
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                      inputMode="tel"
                      maxLength={40}
                    />
                  </Field>
                </div>

                <Field
                  label={t("rental.signatureCount")}
                  hint={t("rental.signatureCountHint")}
                  requirement="required"
                  error={
                    signatureCount === "" || signaturesValid
                      ? undefined
                      : t("rental.signatureCountInvalid", {
                          max: MAX_SIGNATURES,
                        })
                  }
                >
                  <div className="max-w-24">
                    <Input
                      type="number"
                      min={1}
                      max={MAX_SIGNATURES}
                      value={signatureCount}
                      onChange={(e) => setSignatureCount(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </Field>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* ── Perioden ─────────────────────────────────────────── */}
        <Card>
          <CardHeader title={t("rental.sectionPeriod")} />
          <CardBody className="@container space-y-4">
            <div className="grid gap-4 @xl:grid-cols-2">
              <Field label={t("rental.pickupAt")} requirement="required">
                <DateInput value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} />
              </Field>
              <Field
                label={t("rental.returnAt")}
                requirement="required"
                error={datesOrdered ? undefined : t("rental.returnBeforePickup")}
              >
                <DateInput value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
              </Field>
            </div>
            {/* Optional. The villkor say the gear must be used "på det sätt den är avsedd för"; that clause needs a stated purpose. */}
            <Field
              label={t("rental.purpose")}
              hint={t("rental.purposeHint")}
              requirement="required"
            >
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500} />
            </Field>
          </CardBody>
        </Card>

        {/* ── Utrustning och pengar ────────────────────────────── */}
        <Card>
          <CardHeader
            title={t("rental.sectionEquipment")}
            subtitle={free === undefined ? t("rental.pickDatesFirst") : undefined}
          />
          <RentalLines
            items={items}
            value={lines}
            onChange={setLines}
            freeFor={freeFor}
            toOre={toOre}
            // One spare row, as the form started with (a rental is rarely more than a handful of lines).
            blankRows={1}
          />
          <CardBody className="@container space-y-5 border-t border-border">
            {/* Every figure here is worked out; nothing is typed (discounts are on the lines). */}
            <div className="flex justify-end">
              <div className="w-full max-w-xs space-y-2.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted">{t("rental.subtotal")}</span>
                  <Amount value={oreToSEK(pricing.subtotalOre)} />
                </div>

                {pricing.discountOre > 0 && (
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-muted">{t("rental.discount")}</span>
                    <span className="text-muted">
                      <Amount value={-oreToSEK(pricing.discountOre)} />
                    </span>
                  </div>
                )}

                <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
                  <span className="text-sm font-medium">{t("rental.price")}</span>
                  <span className="text-lg font-semibold">
                    <Amount value={oreToSEK(pricing.totalOre)} />
                  </span>
                </div>

                {/* What is at stake is the figure the liability clause points at, shown in the same footer as what is owed. */}
                {totalReplacementOre > 0 && (
                  <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
                    <span>{t("rental.totalReplacement")}</span>
                    <Amount value={oreToSEK(totalReplacementOre)} />
                  </div>
                )}

                {pricing.subtotalOre > 0 && pricing.totalOre > 0 && (
                  <div className="flex justify-end">
                    <Button variant="link" type="button" className="text-xs" onClick={lendFree}>
                      {t("rental.lendFree")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-warning">{ready ? null : t("rental.incomplete")}</p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                // Cancelling a new rental discards its draft; an edit has no draft, and its key belongs to a new rental.
                if (!existing) forgetDraft();
                router.push(existing ? `/contracts/${existing.id}` : "/rentals");
              }}
            >
              {t("form.cancel")}
            </Button>
            <Button onClick={save} loading={pending !== null} disabled={!ready}>
              {existing ? t("rental.save") : t("rental.create")}
            </Button>
          </div>
        </div>
      </div>

      {newCounterpartyName !== null && (
        <CounterpartyDialog
          counterparty={null}
          initialName={newCounterpartyName}
          onSaved={counterpartyCreated}
          onClose={() => setNewCounterpartyName(null)}
        />
      )}
    </PageShell>
  );
}
