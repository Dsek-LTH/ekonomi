"use client";

// Milersättning: the form for driving the section's errand in your own car.
//
// Its own screen rather than a third branch of the ordinary wizard, because
// what is being described is different in kind. There is no receipt to upload,
// no amount to type. The money is the distance at the schablon, and nothing
// to match against the card, since the money left the claimant's own account.
// What comes out the far end is an ordinary utlägg all the same: paymentType
// MILEAGE, allocations over cost centres, the same attest, booking and export.
// See lib/mileage/ for the arithmetic; the journey it describes is printed on
// the utläggsräkning (lib/expense/document.ts), which is the claim's own
// underlag.
//
// One journey per claim. Somebody who drove three times fills this in three
// times, and gets three claims, each attested on its own and on its own cost
// centre, which is what a sheet of journeys sharing one amount could not do.
//
// What is asked for is the odometer at each end, not a distance. The difference
// is the app's to work out, and the two readings are what an attester can
// actually question: "42 km" is a number somebody arrived at, "12 300 → 12 342"
// is a statement about what the car said.
//
// Two steps rather than the wizard's three: the journey and the review. The
// match step exists for card purchases and there is no such thing here.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useReturnTo } from "@/components/shell/route-history";
import { useProgressRouter } from "@/components/shell/route-progress";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { PageShell } from "@/components/page-shell";
import { wizardChrome } from "../wizard-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DetailList, DetailRow } from "@/components/ui/detail-list";
import { Field, FieldGroup, Input, DateInput } from "@/components/ui/field";
import { Stepper } from "@/components/ui/stepper";
import { SubmitBlockerNote } from "@/components/submit-blocker-note";
import { Amount } from "@/components/ui/amount";
import { IconCheck } from "@/components/ui/icons";
import { AllocationEditor, makeRow, type AllocationRow } from "@/components/allocation-editor";
import {
  REIMBURSEMENT_DEADLINE_DAYS,
  isLateReimbursement,
  isSubmittable,
  submitBlocker,
} from "@/lib/domain/status";
import { isCompleteDate, isFutureDate } from "@/lib/domain/date";
import { commaForm, oreToSEK, parseOre, parseSEK } from "@/lib/domain/money";
import { claimBlocker, valueJourney } from "@/lib/mileage/claim";
import type { MileageRateLike } from "@/lib/mileage/rate";
import type { CreateExpense, PatchExpense } from "@/lib/api/schemas/expense";
import type { CostCenter, Expense } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { useSelectOnce } from "@/lib/ui/use-select-once";

/**
 * What an odometer field holds. Kept as text for the same reason the amount
 * fields are: "12 300," is something somebody is in the middle of typing, and a
 * number input would either refuse it or silently make it 12300.
 *
 * Null rather than 0 for "nothing typed yet". 0 is a real reading (a trip
 * meter just zeroed, a car straight off the lot), so the two must not collapse
 * into the same value.
 */
const readOdometer = (text: string): number | null => {
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Whether a string is on its way to being a reading: digits, one separator,
 *  one decimal. Anything else is not taken, so the field keeps what it had,
 *  the same rule `isAmountInput` holds for money. */
const isOdometerInput = (text: string): boolean => /^\d{0,7}([.,]\d?)?$/.test(text);

/** A stored reading back into the text the field holds, with the comma a
 *  Swedish reader would have typed it with. */
const showOdometer = (km: number | null | undefined): string =>
  km == null ? "" : String(km).replace(".", ",");

export default function MileageClient({
  costCenters,
  payoutClearing,
  payoutAccount,
  rates,
  existing,
}: {
  costCenters: CostCenter[];
  payoutClearing: string;
  payoutAccount: string;
  rates: MileageRateLike[];
  /**
   * The claim being edited, when this form was opened from one. Same shape the
   * ordinary wizard takes for the same reason: a mileage claim is edited by the
   * form that knows how to describe one, and the edit page picks between the
   * two on `paymentType`.
   */
  existing?: Expense;
}) {
  const router = useProgressRouter();
  const returnTo = useReturnTo();
  const t = useTranslations("mileage");
  const tWizard = useTranslations("expenses.wizard");
  const tNav = useTranslations("nav");
  const tPayment = useTranslations("common.payment");
  const { date } = useFormat();
  const selectOnce = useSelectOnce();
  const notify = useNotify();

  const editing = Boolean(existing);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(() => existing?.title ?? "");
  const [journeyDate, setJourneyDate] = useState(() => existing?.purchaseDate ?? "");
  const [startText, setStartText] = useState(() =>
    showOdometer(existing?.mileage?.odometerStart),
  );
  const [endText, setEndText] = useState(() => showOdometer(existing?.mileage?.odometerEnd));
  // Unpicked to start with, exactly as the ordinary wizard's is: choosing a
  // cost centre is the claimant's call, and defaulting to whichever sorts first
  // is how a wrong one goes through unnoticed.
  const [allocations, setAllocations] = useState<AllocationRow[]>(() =>
    existing?.allocations.length
      ? existing.allocations.map((a) =>
          makeRow(a.costCenterCode, String(a.amount), a.comment ?? ""),
        )
      : [makeRow("")],
  );
  const [draftId, setDraftId] = useState<string | null>(existing?.id ?? null);

  const { pending, mutate } = useMutation();
  const saving = pending === "save";
  const [exit, setExit] = useState<"draft" | "submit" | null>(null);

  // Active ones, plus any this claim already uses, so an allocation on a
  // since-retired cost centre stays selectable while it is being edited.
  const usedCodes = new Set(existing?.allocations.map((a) => a.costCenterCode) ?? []);
  const selectableCostCenters = costCenters.filter((c) => c.active || usedCodes.has(c.code));

  const journey = {
    date: journeyDate,
    odometerStart: readOdometer(startText),
    odometerEnd: readOdometer(endText),
  };

  // What the journey comes to, worked out here with the same function the
  // server uses. Not a convenience: the amount is never typed on this form, so
  // this is the only place the claimant sees what they are asking for before
  // they ask for it.
  const valued = valueJourney(journey, rates);
  const grossSEK = oreToSEK(valued.ore ?? 0);
  const journeyBlocker = claimBlocker(journey, rates);

  // The date field is a mask, so it can be left half-typed ("2026", "2026-07").
  // Empty is a draft in progress; a partial date is an error to point at.
  const dateIncomplete = journeyDate !== "" && !isCompleteDate(journeyDate);
  const dateInFuture = isFutureDate(journeyDate);
  // Past the filing deadline, which a milersättning has exactly as an eget
  // utlägg does. It is the claimant's own petrol out of the claimant's own
  // account, and a stale one is as uncheckable as a stale receipt. Said here,
  // under the field, rather than left for the review step: this is the one
  // blocker nobody can fix by filling something else in, so finding it after
  // the readings and the fördelning is finding it too late.
  const dateTooLate = isLateReimbursement(journeyDate, "MILEAGE");

  const blocker = submitBlocker({
    title,
    purchaseDate: journeyDate,
    grossAmount: grossSEK,
    paymentType: "MILEAGE",
    // There is no receipt on a milersättning and there is not meant to be: the
    // journey stands as its own underlag on the utläggsräkning, and
    // `mileageBlocker` is what stands in the receipt check's place. See
    // submitBlocker.
    hasReceipt: false,
    mileageBlocker: journeyBlocker,
    submitterHasPayout: Boolean(payoutClearing && payoutAccount),
    allocations: allocations.map((a) => ({
      amount: parseSEK(a.amount),
      costCenterCode: a.costCenterCode,
    })),
  });

  // Enough to move on: a journey that would be accepted, a day that has been,
  // and a cost centre on every row. The distribution itself is checked at the
  // end, where the ordinary wizard checks it.
  const filledForm =
    !journeyBlocker &&
    !dateInFuture &&
    !dateTooLate &&
    allocations.length > 0 &&
    allocations.every((a) => a.costCenterCode);
  // A draft may be saved with the readings still missing, since that is what a
  // draft is for, but not with nothing to call it, not with a half-typed date (which
  // would be stored as 1 January of the year typed so far), and not with a day
  // that has not come, which the server refuses anyway.
  // …and not past the deadline: PATCH refuses to store one (the same rule, on
  // the server), so a save that went ahead would fail with a toast instead of
  // the sentence under the field that already says what is wrong.
  const canPersist =
    title.trim() !== "" && !dateIncomplete && !dateInFuture && !dateTooLate && !saving;
  // An attested claim can still be corrected but not re-sent from this form.
  // the same rule the ordinary wizard holds to.
  const submittable = !existing || isSubmittable(existing.status);

  /**
   * Everything this form writes, in the order it has to happen.
   *
   * The amount is not sent: it is the server's, worked out from the two
   * readings against the rate in force on the journey's day (see
   * PatchExpense.odometerStart). What goes up is what the car said, and what
   * comes back is what it is worth.
   */
  async function persist(): Promise<string | null> {
    let id = draftId;
    if (!id) {
      const create: CreateExpense = {
        paymentType: "MILEAGE",
        title: "",
        // Nothing to match: the money left the claimant's own account, and
        // isMatchable refuses a match on anything but a card purchase.
        matchedTransactionId: null,
      };
      const created = await mutate<{ id: string }>("/api/expenses", {
        key: "save",
        body: create,
        error: tWizard("createFailed"),
        refresh: false,
      });
      if (!created) return null;
      id = created.id;
      setDraftId(id);
    }
    const patch: PatchExpense = {
      title,
      paymentType: "MILEAGE",
      purchaseDate: journeyDate || null,
      odometerStart: journey.odometerStart,
      odometerEnd: journey.odometerEnd,
      allocations: allocations.map((a) => ({
        costCenterCode: a.costCenterCode,
        amount: parseOre(a.amount),
        comment: a.comment || undefined,
      })),
    };
    const saved = await mutate(`/api/expenses/${id}`, {
      key: "save",
      method: "PATCH",
      body: patch,
      error: tWizard("saveFailed"),
    });
    return saved === null ? null : id;
  }

  function done(id: string) {
    // Replaces the wizard's entry rather than pushing past it. See the
    // claim wizard's `done`, which this mirrors.
    returnTo(`/expenses/${id}`);
  }

  async function saveDraft() {
    setExit("draft");
    const id = await persist();
    if (!id) return setExit(null);
    notify.success(editing ? tWizard("savedChanges") : tWizard("savedDraft"));
    done(id);
  }

  async function submitClaim() {
    setExit("submit");
    const id = await persist();
    if (!id) return setExit(null);
    const sent = await mutate(`/api/expenses/${id}/transition`, {
      key: "save",
      body: { action: "submit" },
      error: tWizard("submitFailed"),
    });
    if (!sent) return setExit(null);
    notify.success(tWizard("submitted"));
    done(id);
  }

  const nf = (min: number, max: number) =>
    new Intl.NumberFormat("sv-SE", { minimumFractionDigits: min, maximumFractionDigits: max });
  const money = (sek: number) => nf(2, 2).format(sek);
  const km = (n: number) => nf(0, 1).format(n);

  const odometerField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    autoFocus = false,
  ) => (
    <Field label={label}>
      {/* Not type="number": it would refuse the space a six-digit reading is
          naturally typed with and fight the comma on a Swedish keyboard.
          `isOdometerInput` takes what is on its way to a reading and nothing
          else, so the field keeps what it had. */}
      <Input
        autoFocus={autoFocus}
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          if (!isOdometerInput(e.target.value)) return;
          onChange(e.target.value);
        }}
        // Shown back with the comma a Swedish reader writes, whichever
        // separator the phone's keypad happened to offer, the same rule the
        // amount fields hold to. On blur, not per keystroke: "12 300," is an
        // ordinary thing to be half-way through typing.
        onBlur={() => {
          const shown = commaForm(value);
          if (shown !== value) onChange(shown);
        }}
      />
    </Field>
  );

  const chrome = wizardChrome({
    existing,
    t,
    draftLabel: tWizard("draftLabel"),
    listLabel: tNav("expenses"),
  });

  return (
    <PageShell
      title={chrome.title}
      description={chrome.description}
      back={chrome.back}
      width="content"
    >
      <Stepper steps={[t("step.journey"), tWizard("step.submit")]} current={step} />

      {/* The panel shows the utläggsräkning itself, once there is a draft to
          draw one from, the same one document that goes to Fortnox, with the
          journey printed on it. Before the first save there is nothing at an
          address yet, so the panel says what will appear there rather than
          standing empty. It never takes an upload: on this form there is
          nothing to upload, and a dropzone would be an invitation to attach a
          receipt that has no place on the claim. */}
      <ReceiptPanelSource
        documentUrl={draftId ? `/api/expenses/${draftId}/document` : null}
        mimeType="application/pdf"
        filename={t("documentName")}
        emptyTitle={t("documentTitle")}
        emptyDescription={t("documentPending")}
      />

      {/* Step 1: the journey */}
      {step === 0 && (
        <Card>
          <CardBody className="space-y-5">
            <Field label={t("description")} hint={t("descriptionHint")} requirement="required">
              <Input
                autoFocus
                onFocus={selectOnce}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>

            <Field
              label={t("journeyDate")}
              requirement="required"
              error={
                dateIncomplete
                  ? tWizard("dateIncomplete")
                  : dateInFuture
                    ? t("dateFuture")
                    : dateTooLate
                      ? t("dateTooLate", { days: REIMBURSEMENT_DEADLINE_DAYS })
                      : undefined
              }
            >
              <DateInput
                value={journeyDate}
                onChange={(e) => setJourneyDate(e.target.value)}
              />
            </Field>

            {/* The two readings, side by side because they are one measurement
                taken twice, and in the order they happen, so filling them in
                reads like the journey did. */}
            <FieldGroup label={t("odometer.label")} hint={t("odometer.hint")} requirement="required">
              <div className="grid grid-cols-2 gap-3 sm:gap-5">
                {odometerField(t("odometer.start"), startText, setStartText)}
                {odometerField(t("odometer.end"), endText, setEndText)}
              </div>
            </FieldGroup>

            {/* The distance and what it comes to: neither typed, both shown.
                The subtraction is stated rather than only its answer, because
                somebody checking their own claim should be able to see where
                the figure came from without doing the arithmetic again. */}
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-surface px-3.5 py-3">
              <span className="text-sm text-muted">
                {valued.km == null
                  ? t("total")
                  : t("sum", {
                      km: km(valued.km),
                      rate: valued.orePerKm == null ? "–" : money(valued.orePerKm / 100),
                    })}
              </span>
              <span className="text-lg font-semibold tabular-nums">{money(grossSEK)} kr</span>
            </div>

            <FieldGroup label={tWizard("distribution")} requirement="required">
              <AllocationEditor
                costCenters={selectableCostCenters}
                grossAmount={grossSEK}
                value={allocations}
                onChange={setAllocations}
              />
            </FieldGroup>

            {/* The payment type, said rather than asked. It is the one thing
                this form does not offer a choice about. The choice was made
                by opening it, but leaving it out entirely would make the two
                forms look like different features rather than one question
                answered three ways. The other two are a link back. */}
            <FieldGroup label={tWizard("paymentType")}>
              <div className="rounded-xl border border-accent bg-accent-soft px-4 py-3">
                <span className="block text-sm font-medium">
                  {tPayment("MILEAGE.label")}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {tPayment("MILEAGE.description")}
                </span>
              </div>
              {/* The way back, for somebody who picked the wrong item on the
                  "Nytt utlägg" menu. A line of text rather than a third option
                  card: the choice between the two forms is made before either
                  is drawn (components/new-expense-menu.tsx), and re-offering it
                  here as a control would put a door back among the switches.
                  Nothing is lost on the way. This form has been open for as
                  long as it took to notice. */}
              {!editing && (
                <p className="mt-2 text-xs text-muted">
                  {t("otherType")}{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/expenses/new")}
                    className="font-medium text-accent hover:underline"
                  >
                    {t("otherTypeLink")}
                  </button>
                </p>
              )}
            </FieldGroup>

            {/* Why Fortsätt is dead, said in the card rather than left to be
                guessed at from a greyed-out button. */}
            {journeyBlocker && (
              <p className="text-xs text-warning">{t(`blocker.${journeyBlocker}`)}</p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                onClick={saveDraft}
                disabled={!canPersist}
                loading={exit === "draft"}
              >
                {editing ? tWizard("save") : tWizard("saveDraft")}
              </Button>
              <Button disabled={!filledForm} onClick={() => setStep(1)}>
                {tWizard("continue")}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 2: review and send */}
      {step === 1 && (
        <Card>
          <CardBody className="space-y-5">
            <h2 className="text-base font-semibold">{tWizard("reviewTitle")}</h2>
            <DetailList>
              <DetailRow label={t("description")} value={title} />
              <DetailRow
                label={t("journeyDate")}
                value={journeyDate ? date(journeyDate) : "–"}
              />
              {/* The readings as well as the distance: the review step is the
                  last look before this becomes somebody else's to check, and
                  what they will be checking is these two numbers. */}
              <DetailRow
                label={t("odometer.label")}
                value={`${startText || "–"} → ${endText || "–"}`}
              />
              <DetailRow
                label={t("distance")}
                value={valued.km == null ? "–" : t("km", { km: km(valued.km) })}
              />
              <DetailRow label={tWizard("amount")} value={<Amount value={grossSEK} />} />
              {allocations.map((a, i) => (
                <DetailRow
                  key={a.id}
                  label={i === 0 ? tWizard("distribution") : ""}
                  value={
                    <>
                      {a.costCenterCode} – <Amount value={parseSEK(a.amount)} signed />
                    </>
                  }
                />
              ))}
              <DetailRow label={tWizard("paymentType")} value={tPayment("MILEAGE.label")} />
              <DetailRow
                label={tWizard("payoutTo")}
                value={
                  payoutClearing && payoutAccount
                    ? `${payoutClearing} – ${payoutAccount}`
                    : tWizard("payoutMissing")
                }
              />
            </DetailList>

            <div className="flex items-center gap-2 rounded-xl bg-surface px-3.5 py-2.5 text-sm text-muted">
              <IconCheck className="size-4 shrink-0 text-success" />
              {tWizard("goesTo", {
                resultUnits:
                  [
                    ...new Set(
                      allocations
                        .map(
                          (a) =>
                            costCenters.find((c) => c.code === a.costCenterCode)?.resultUnit,
                        )
                        .filter(Boolean),
                    ),
                  ].join(", ") || tWizard("resultUnitConcerned"),
              })}
            </div>

            {submittable && blocker && (
              <SubmitBlockerNote
                blocker={blocker}
                paymentType="MILEAGE"
                className="text-xs text-warning"
              />
            )}
            <p className="text-xs text-muted">
              {t("deadlineHint", { days: REIMBURSEMENT_DEADLINE_DAYS })}
            </p>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button variant="ghost" onClick={() => setStep(0)}>
                {tWizard("back")}
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={saveDraft}
                  disabled={!canPersist}
                  loading={exit === "draft"}
                >
                  {editing ? tWizard("save") : tWizard("saveDraft")}
                </Button>
                {submittable && !blocker && (
                  <Button
                    onClick={submitClaim}
                    loading={exit === "submit"}
                    disabled={!canPersist}
                  >
                    {existing?.status === "CHANGES_REQUESTED"
                      ? tWizard("resubmit")
                      : tWizard("submit")}
                  </Button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </PageShell>
  );
}
