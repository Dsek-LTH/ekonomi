"use client";

// Drawing an uthyrningsavtal.
//
// The one place in the app where a contract comes into being. Everything else
// under /contracts files an agreement that was signed somewhere else; this page
// takes answers and draws a document out of them, which the counterparty then
// reads and signs. Its sibling is contracts/upload, and each offers the other
// at the foot so a wrong turn costs nothing.
//
// Three blocks, each one subject, in the order the conversation goes: who the
// two parties are, when, and what for how much.
//
// The parties share a row, in the shape the document draws them, with our side
// already answered and only the signatory to choose. Ours used to be a fourth
// card at the foot, so the form asked who represents the renter, then the
// period, then the gear, and then who represents us: one subject split in half
// by three others. That is the same fault this form was reorganised to fix once
// before, when it asked for the renter's organisation, then our own signatory,
// then the person signing for the renter. And it asked for four things the app already knew: a title (the
// renter, plus the fact that it is a rental), tags (archive machinery for
// filing a sponsoravtal), notes (worth having, worth nothing at this moment)
// and the post the signatory signs under (they hold firmateckning through a
// role that can be read). All four are gone. See lib/contract/signatory.ts.
//
// Widths are container queries throughout, not viewport breakpoints. This form
// sits beside a panel you can drag, so its width changes while the viewport
// does not move at all, which is the same reason AllocationEditor is written
// that way and the reason `sm:` was the wrong question here.
import { useEffect, useState } from "react";
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
import { useFormat } from "@/lib/ui/use-format";
import { parseSEK } from "@/lib/domain/money";
import { isCompleteDate } from "@/lib/domain/date";
import { Amount } from "@/components/ui/amount";
import { oreToSEK } from "@/lib/domain/money";
import { rentalPricing } from "@/lib/contract/rental/pricing";
import { SECTION } from "@/lib/contract/section";
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

const toOre = (input: string) => (input.trim() === "" ? 0 : Math.round(parseSEK(input) * 100));
const kr = (ore: number) => (ore / 100).toFixed(2);

export function NewRentalClient({
  items,
  signatories,
  defaultSignatoryId,
  counterparties,
}: {
  items: RentalItemOption[];
  signatories: { id: string; name: string }[];
  defaultSignatoryId: string;
  counterparties: CounterpartyOption[];
}) {
  const t = useTranslations("contracts");
  const tc = useTranslations("contracts.counterparties");
  const router = useRouter();
  const { mutate, pending } = useMutation();
  const { date } = useFormat();

  // Hyrestagaren, picked from the directory rather than typed. See
  // upload-client.tsx, which does the same thing for the archive form.
  const [counterpartyOptions, setCounterpartyOptions] = useState(counterparties);
  const [counterpartyId, setCounterpartyId] = useState<string | null>(null);
  const [newCounterpartyName, setNewCounterpartyName] = useState<string | null>(null);
  const counterparty = counterpartyOptions.find((c) => c.id === counterpartyId)?.name ?? "";
  const [orgNo, setOrgNo] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [renterName, setRenterName] = useState("");
  const [renterEmail, setRenterEmail] = useState("");
  const [renterPhone, setRenterPhone] = useState("");

  function pickCounterparty(id: string) {
    setCounterpartyId(id || null);
    const picked = counterpartyOptions.find((c) => c.id === id);
    setOrgNo(picked?.orgNo ?? "");
    setAddress(picked?.address ?? "");
    setPostalCode(picked?.postalCode ?? "");
    setCity(picked?.city ?? "");
  }

  function counterpartyCreated(created: CounterpartyOption) {
    setCounterpartyOptions((prev) => [...prev, created]);
    setCounterpartyId(created.id);
    setOrgNo(created.orgNo ?? "");
    setAddress(created.address ?? "");
    setPostalCode(created.postalCode ?? "");
    setCity(created.city ?? "");
    setNewCounterpartyName(null);
  }

  // Perioden
  const [pickupAt, setPickupAt] = useState("");
  const [returnAt, setReturnAt] = useState("");
  const [place, setPlace] = useState("");
  const [purpose, setPurpose] = useState("");

  // Utrustning och pengar. No money field here: every figure below the lines
  // is worked out from them, discounts included. See rental/pricing.ts.
  const [lines, setLines] = useState<LineRow[]>([makeLine()]);

  // Underskrift
  const [signatoryId, setSignatoryId] = useState(defaultSignatoryId);

  // What is free over the chosen period, stamped with the dates it was fetched
  // for and read back only while those still match the fields, so a stale
  // answer is impossible rather than merely unlikely.
  const [fetched, setFetched] = useState<
    { from: string; to: string; rows: Map<string, Availability> } | undefined
  >(undefined);

  const periodReady =
    isCompleteDate(pickupAt) && isCompleteDate(returnAt) && returnAt >= pickupAt;

  const free =
    periodReady && fetched?.from === pickupAt && fetched?.to === returnAt
      ? fetched.rows
      : undefined;

  useEffect(() => {
    if (!periodReady) return;
    const abort = new AbortController();
    fetch(`/api/rental-items/availability?from=${pickupAt}&to=${returnAt}`, {
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
      // A failed check leaves the form saying nothing rather than saying
      // everything is free. The create route checks again server-side, so the
      // worst case is a refusal at submit rather than a double booking.
      .catch(() => undefined);
    return () => abort.abort();
  }, [pickupAt, returnAt, periodReady]);

  /** What is left of an item, counting what this form has already claimed on
   *  its other lines. Without that, a form listing the Soundboks twice would
   *  draw both rows as fine and be refused at submit. */
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

  // The same function the create route runs over the same lines, so the figure
  // on the screen and the figure in the database cannot come apart.
  const pricing = rentalPricing(
    filled.map((l) => ({
      quantity: Number(l.quantity) || 0,
      unitPriceOre: toOre(l.unitPrice),
      discountPercent: effectiveDiscountPercent(l, toOre),
    })),
  );
  /** Every line off at 100 per cent, which is how a free loan is written.
   *  Always percent, regardless of what a line's discount is typed as: "off
   *  by however much this happens to cost" is a percentage, not a kr figure
   *  to work out first. */
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
    renterName.trim() !== "" &&
    orgNo.trim() !== "" &&
    address.trim() !== "" &&
    postalCode.trim() !== "" &&
    city.trim() !== "" &&
    purpose.trim() !== "" &&
    periodReady &&
    filled.length > 0 &&
    signatoryId !== "" &&
    !anyShort;

  // One line saying what is about to be made, beside the button that makes it.
  const summary =
    filled.length === 0 || !periodReady
      ? null
      : t("rental.summary", {
          items: t("rental.itemSummary", {
            count: filled.reduce((n, l) => n + (Number(l.quantity) || 0), 0),
          }),
          period: `${date(pickupAt)} – ${date(returnAt)}`,
          price: `${kr(pricing.totalOre)} kr`,
        });

  // ── The document, drawn as it is described ─────────────────────
  //
  // The panel beside this form shows the contract itself, redrawn whenever an
  // answer that appears on it changes. It goes through the same builder and the
  // same template the saved contract will, so what is on screen is the document
  // rather than an impression of it.
  //
  // Keyed on a string of exactly the fields the document prints. Comparing the
  // draft by value rather than by identity is what stops a redraw on every
  // keystroke in a field the document does not show, and on every render caused
  // by something else entirely.
  const draft = {
    counterparty: counterparty.trim(),
    counterpartyOrgNo: orgNo.trim(),
    counterpartyAddress: address.trim(),
    counterpartyPostalCode: postalCode.trim(),
    counterpartyCity: city.trim(),
    pickupAt: isCompleteDate(pickupAt) ? pickupAt : null,
    returnAt: isCompleteDate(returnAt) ? returnAt : null,
    purpose: purpose.trim(),
    place: place.trim(),
    lines: filled.map((l) => ({
      description: l.description.trim(),
      quantity: Number(l.quantity) || 0,
      unitPriceOre: toOre(l.unitPrice),
      discountPercent: effectiveDiscountPercent(l, toOre),
      replacementValueOre: toOre(l.replacementValue),
    })),
    sectionSignatoryId: signatoryId || null,
    counterpartySignatory: renterName.trim()
      ? { name: renterName.trim(), email: renterEmail.trim(), phone: renterPhone.trim() }
      : null,
  };
  const draftKey = JSON.stringify(draft);

  const [preview, setPreview] = useState<string | null>(null);
  // Revoked when it is replaced and when the page goes, because otherwise the
  // browser holds every rendering the form ever produced for the life of the
  // tab, and this one produces a new one every few seconds.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    const abort = new AbortController();
    // Long enough that typing a sentence into "Ändamål" is one render rather
    // than fifteen, short enough that it still feels like it is following you.
    const timer = setTimeout(() => {
      fetch("/api/contracts/rental/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: draftKey,
        signal: abort.signal,
      })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((blob) => setPreview(URL.createObjectURL(blob)))
        // A preview that would not draw leaves the last one standing rather
        // than blanking the panel. Nothing here is the contract; the document
        // that matters is drawn again on save, by the route, from the row.
        .catch(() => undefined);
    }, 600);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
    // The draft's contents, not its identity: a new object every render would
    // redraw the document forever.
  }, [draftKey]);

  async function create() {
    const created = await mutate<{ id: string }>("/api/contracts/rental", {
      body: {
        counterparty: draft.counterparty,
        counterpartyOrgNo: draft.counterpartyOrgNo,
        counterpartyAddress: draft.counterpartyAddress,
        counterpartyPostalCode: draft.counterpartyPostalCode,
        counterpartyCity: draft.counterpartyCity,
        counterpartyId,
        pickupAt,
        returnAt,
        purpose: purpose.trim(),
        place: place.trim() || null,
        // No due date is sent either: absent is what the villkor already
        // read as "vid uthämtningen", the ordinary case, and there is no
        // field here to have typed one into.
        // No rent is sent. The route runs the same pricing over the lines it is
        // given, so there is one place the subtraction happens.
        lines: filled.map((l) => ({
          itemId: l.itemId,
          description: l.description.trim(),
          quantity: Number(l.quantity) || 1,
          unitPriceOre: toOre(l.unitPrice),
          discountPercent: effectiveDiscountPercent(l, toOre),
          replacementValueOre: toOre(l.replacementValue),
        })),
        sectionSignatoryId: signatoryId,
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
    });
    if (created) router.push(`/contracts/${created.id}`);
  }

  return (
    <PageShell
      title={t("rental.newTitle")}
      description={t("rental.newDescription")}
      width="content"
      back={{ href: "/uthyrning", label: t("rental.backToRentals") }}
    >
      {/* The contract, beside the form that describes it. No `onFile`: there is
          nothing to upload here, the document is drawn rather than attached,
          and a dropzone would invite somebody to add a PDF that has no place on
          a contract this app writes itself. */}
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
        {/*
            The two parties on one row, in the order and the shape the document
            puts them in, because the document is open in the panel beside this
            form and a form whose blocks do not correspond to the page it draws
            makes the reader do the mapping.

            It also puts the two "Representerad av" questions on the same line.
            They were two cards apart, which is exactly the fault this file's
            header comment says the form was reorganised to fix: one subject
            split in half by another. The renter's representative was asked
            first, then the period, then the gear, then ours.

            Our side is answered already and cannot be typed over. It is shown
            rather than hidden because it is printed on the contract, and a form
            that never mentions the section produces a document that suddenly
            does. The one thing on that side anybody chooses is who signs.
        */}
        <Card>
          <CardHeader title={t("rental.parties")} subtitle={t("rental.counterpartyHint")} />
          <CardBody className="@container">
            <div className="grid gap-x-8 gap-y-6 @3xl:grid-cols-2">
              {/* ── Uthyraren ───────────────────────────────────── */}
              <div className="@container space-y-4">
                <h3 className="text-[13px] font-medium text-foreground">{t("rental.lessor")}</h3>

                {/* Static, and drawn as text rather than as disabled inputs: a
                    greyed-out field reads as something that is broken or that
                    you have not earned, and this is neither. It is simply not
                    a question. */}
                <div className="space-y-0.5 rounded-xl bg-surface px-4 py-3 text-sm">
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

                <FieldGroup
                  label={t("rental.representedBy")}
                  hint={
                    signatories.length === 0
                      ? t("rental.noSignatories")
                      : t("rental.signatoryHint")
                  }
                  requirement="required"
                >
                  <Combobox
                    options={signatories.map((sig) => ({ value: sig.id, label: sig.name }))}
                    value={signatoryId}
                    onChange={setSignatoryId}
                    placeholder={t("rental.pickSignatory")}
                    aria-label={t("rental.representedBy")}
                  />
                </FieldGroup>
              </div>

              {/* ── Hyrestagaren ────────────────────────────────── */}
              {/* Its own container, so the grids below measure this column
                  rather than the card. At half the width a row of three would
                  otherwise stay three across in 300px. */}
              <div className="@container space-y-4">
                <h3 className="text-[13px] font-medium text-foreground">
                  {t("rental.counterparty")}
                </h3>

                <div className="grid gap-4 @md:grid-cols-[2fr_1fr]">
                  <FieldGroup
                    label={t("rental.renterOrg")}
                    requirement="required"
                    action={
                      <button
                        type="button"
                        onClick={() => setNewCounterpartyName("")}
                        className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                      >
                        <IconPlus className="size-3.5" />
                        {tc("add")}
                      </button>
                    }
                  >
                    <Combobox
                      options={counterpartyOptions.map((c) => ({ value: c.id, label: c.name }))}
                      value={counterpartyId ?? ""}
                      onChange={pickCounterparty}
                      allowClear
                      placeholder={tc("pick")}
                      searchPlaceholder={tc("pick")}
                      onCreate={(text) => setNewCounterpartyName(text)}
                      createLabel={(text) => tc("createNew", { text })}
                      aria-label={t("rental.renterOrg")}
                    />
                  </FieldGroup>
                  {/* One field for both, because the renter is a company,
                      another section or a private person and the question is
                      the same either way. Required here and optional in the
                      archive: a contract the section may have to enforce over a
                      broken speaker needs somebody it can actually name. */}
                  <Field label={t("rental.renterOrgNo")} requirement="required">
                    <Input value={orgNo} onChange={(e) => setOrgNo(e.target.value)} maxLength={40} />
                  </Field>
                </div>

                {/* Where a claim would be served. An email address is where you
                    ask nicely; this is where you send something that has to
                    arrive. The postal code and the town share a row because
                    that is how the two are read, and how the document sets
                    them. */}
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

                <FieldGroup
                  label={t("rental.representedBy")}
                  hint={t("rental.counterpartySignatoryHint")}
                  requirement="required"
                >
                  {/* Stacked rather than three across: this column is half a
                      card wide, and an email address does not fit a third of
                      that. */}
                  <div className="space-y-2">
                    <Input
                      value={renterName}
                      onChange={(e) => setRenterName(e.target.value)}
                      placeholder={t("party.name")}
                      aria-label={t("party.name")}
                      maxLength={120}
                    />
                    <div className="grid gap-2 @md:grid-cols-2">
                      <Input
                        type="email"
                        value={renterEmail}
                        onChange={(e) => setRenterEmail(e.target.value)}
                        placeholder={t("party.email")}
                        aria-label={t("party.email")}
                        maxLength={200}
                      />
                      <Input
                        value={renterPhone}
                        onChange={(e) => setRenterPhone(e.target.value)}
                        placeholder={t("party.phone")}
                        aria-label={t("party.phone")}
                        maxLength={40}
                      />
                    </div>
                  </div>
                </FieldGroup>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* ── Perioden ─────────────────────────────────────────── */}
        <Card>
          <CardHeader title={t("rental.sectionPeriod")} />
          <CardBody className="@container space-y-4">
            <div className="grid gap-4 @xl:grid-cols-3">
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
              <Field label={t("rental.place")} requirement="optional">
                <Input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} />
              </Field>
            </div>
            {/* Kept, and optional. The villkor say the gear must be used "på
                det sätt den är avsedd för", and that clause needs something to
                point at. */}
            <Field label={t("rental.purpose")} hint={t("rental.purposeHint")} requirement="required">
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
          {/* Flush against the card's own border, the same way the voucher
              sheet sits in its card (components/voucher-editor.tsx, used from
              book-client.tsx): a table reads as a sheet, not as a field, and
              padding around it would say it was one. */}
          <RentalLines
            items={items}
            value={lines}
            onChange={setLines}
            freeFor={freeFor}
            toOre={toOre}
            // One spare row kept ready, same as the form started with. A
            // rental is rarely more than a handful of lines, so three (the
            // voucher sheet's count, for an account/cost-centre grid written
            // line by line) would sit mostly empty.
            blankRows={1}
          />
          <CardBody className="@container space-y-5 border-t border-border">
            {/* What it comes to, set like the foot of an invoice: the lines,
                what comes off them, and the rent, read down one column.
                
                There used to be two prices on this card, one on every line and
                a "Hyra" field beside them that was typed by hand and quietly
                won. Nothing said which the renter would be charged, and lending
                gear for nothing meant typing a 0 over a column of real prices,
                which recorded the reason nowhere. Now the lines are the price
                and the only figure anybody decides is what comes off them. */}
            {/* The foot of the invoice: what the lines come to, what came off
                them, and what is owed. Right-aligned under the column it is the
                sum of, so the arithmetic is followed down one place.

                Every figure here is worked out. Nothing on this block is typed,
                because the discounts are on the lines now. There used to be a
                "Hyra" field beside the rows that was typed by hand and quietly
                won, so a rental had two prices on one screen and nothing said
                which the renter would be charged. */}
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

                {/* What is at stake, which is not a price and is the one
                    figure the liability clause points at. In the same
                    footer as what is owed rather than on the table itself:
                    it used to sit under the lines as a total of its own,
                    which made two footers for one card. */}
                {totalReplacementOre > 0 && (
                  <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
                    <span>{t("rental.totalReplacement")}</span>
                    <Amount value={oreToSEK(totalReplacementOre)} />
                  </div>
                )}

                {/* The common case in one press. Most of what this section
                    lends goes to another section for nothing, and setting every
                    row to 100 by hand is the sort of repetition that ends up
                    with one row missed. */}
                {pricing.subtotalOre > 0 && pricing.totalOre > 0 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-xs font-medium text-accent hover:underline"
                      onClick={lendFree}
                    >
                      {t("rental.lendFree")}
                    </button>
                  </div>
                )}
              </div>
            </div>

          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={ready ? "text-sm text-muted" : "text-xs text-warning"}>
            {ready ? summary : t("rental.incomplete")}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push("/uthyrning")}>
              {t("form.cancel")}
            </Button>
            <Button onClick={create} loading={pending !== null} disabled={!ready}>
              {t("rental.create")}
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
