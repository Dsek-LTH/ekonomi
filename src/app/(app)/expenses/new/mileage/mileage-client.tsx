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
// Laid out as the utlägg form is: one page of fields in a card, and the same
// action bar along the foot saying what it comes to, what is still missing,
// and the two ways out. There is no match section, since there is no card
// purchase to match.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useReturnTo } from "@/components/shell/route-history";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { PageShell } from "@/components/page-shell";
import Link from "next/link";
import { PaymentTag } from "@/components/ui/payment-tag";
import { wizardChrome } from "../wizard-chrome";
import { Card, CardBody } from "@/components/ui/card";
import { ActionBar } from "@/components/action-bar";
import { Field, FieldGroup, Input, DateInput } from "@/components/ui/field";
import { SubmitBlockerNote } from "@/components/submit-blocker-note";
import { Amount } from "@/components/ui/amount";
import { IconX } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/icon-button";
import { AllocationEditor, makeRow, type AllocationRow } from "@/components/allocation-editor";
import {
  REIMBURSEMENT_DEADLINE_DAYS,
  isLateReimbursement,
  isSubmittable,
  submitBlocker,
} from "@/lib/domain/status";
import { isCompleteDate, isFutureDate } from "@/lib/domain/date";
import { useFiscalYear } from "@/components/shell/fiscal-year-context";
import { fiscalYearLabel, outsideFiscalYear } from "@/lib/ui/fiscal-year";
import { commaForm, oreToSEK, parseOre, parseSEK } from "@/lib/domain/money";
import { claimBlocker, valueJourney } from "@/lib/mileage/claim";
import type { MileageRateLike } from "@/lib/mileage/rate";
import type { CreateExpense, PatchExpense } from "@/lib/api/schemas/expense";
import type { CostCenter, Expense } from "@/lib/domain/types";
import { useSelectOnce } from "@/lib/ui/use-select-once";
import { formatNumber } from "@/lib/ui/format";

/**
 * What an odometer field holds. Kept as text for the same reason the amount
 * fields are: "12 300," is something somebody is in the middle of typing, and a
 * number input would either refuse it or silently make it 12300.
 *
 * Null rather than 0 for "nothing typed yet". 0 is a real reading (a car
 * straight off the lot), so the two must not collapse into the same value.
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

/** As many stops as the API will take (PatchExpense.journeyStops). Far past any
 *  errand; the cap is there so a claim cannot carry an unbounded list onto a
 *  typeset page. */
const MAX_STOPS = 20;

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
  const returnTo = useReturnTo();
  const t = useTranslations("mileage");
  const tWizard = useTranslations("expenses.wizard");
  const tCommon = useTranslations("common");
  const fiscalYear = useFiscalYear();
  const selectOnce = useSelectOnce();
  const notify = useNotify();

  const editing = Boolean(existing);
  const [title, setTitle] = useState(() => existing?.title ?? "");
  const [journeyDate, setJourneyDate] = useState(() => existing?.purchaseDate ?? "");
  const [startText, setStartText] = useState(() => showOdometer(existing?.mileage?.odometerStart));
  const [endText, setEndText] = useState(() => showOdometer(existing?.mileage?.odometerEnd));
  /**
   * Every place the car stopped, in order.
   *
   * Two empty rows to start with, because two is the fewest a journey can have
   * and an editor that opened with one would be asking for a route by showing
   * half of one. A claim that went somewhere and came back is that place typed
   * twice; one that called at three is three rows.
   *
   * Plain strings keyed by index rather than rows with ids, unlike the
   * allocation editor: nothing here is focused after the fact, and the order is
   * the whole meaning, so an id would be a handle nothing reaches for.
   */
  const [stops, setStops] = useState<string[]>(() =>
    existing?.mileage?.stops.length ? existing.mileage.stops : ["", ""],
  );
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
    stops,
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
  // In the year picked in the header, as in the receipt wizard.
  const dateOutsideYear =
    journeyDate !== (existing?.purchaseDate ?? "") && outsideFiscalYear(fiscalYear, journeyDate);
  // Past the filing deadline, which a milersättning has exactly as an eget
  // utlägg does. It is the claimant's own petrol out of the claimant's own
  // account, and a stale one is as uncheckable as a stale receipt. Said here,
  // under the field, rather than left for the review step: this is the one
  // blocker nobody can fix by filling something else in, so finding it after
  // the readings and the fördelning is finding it too late.
  // A warning, not a wall. The journey can be written down and saved; it is
  // sending it that the deadline stops, which `blocker` below still says. See
  // the same field in the receipt wizard for why this changed.
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
    // False, and it cannot be anything else here: a dispens is granted against
    // an utlägg that already exists, by somebody who is not the person filling
    // this in. Somebody whose claim is too old sees the deadline here and asks
    // the skattmästare, and the dispens shows up on the detail page.
    deadlineWaived: false,
    allocations: allocations.map((a) => ({
      amount: parseSEK(a.amount),
      costCenterCode: a.costCenterCode,
    })),
  });

  // A draft may be saved with the readings still missing, since that is what a
  // draft is for, but not with nothing to call it, not with a half-typed date (which
  // would be stored as 1 January of the year typed so far), and not with a day
  // that has not come, which the server refuses anyway.
  // …and not past the deadline: PATCH refuses to store one (the same rule, on
  // the server), so a save that went ahead would fail with a toast instead of
  // the sentence under the field that already says what is wrong.
  const canPersist =
    title.trim() !== "" && !dateIncomplete && !dateInFuture && !dateOutsideYear && !saving;
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
      journeyStops: stops,
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

  const money = (sek: number) => formatNumber(sek, 2, 2);
  const km = (n: number) => formatNumber(n, 0, 1);

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

  const chrome = wizardChrome({ existing, t });

  // What still has to be filled in before this can be sent, by name, for the
  // action bar. In the order the page asks for them, as on the utlägg form.
  const missing = [
    !title.trim() && tWizard("missing.title"),
    !isCompleteDate(journeyDate) && tWizard("missing.date"),
    journeyBlocker === "noRoute" && t("missing.route"),
    journeyBlocker === "noReadings" && t("missing.readings"),
    (allocations.length === 0 || allocations.some((a) => !a.costCenterCode)) &&
      tWizard("missing.costCenter"),
  ].filter((m): m is string => Boolean(m));

  // Whose attest it goes to: the result units its cost centres belong to.
  const resultUnits = [
    ...new Set(
      allocations
        .map((a) => costCenters.find((c) => c.code === a.costCenterCode)?.resultUnit)
        .filter(Boolean),
    ),
  ].join(", ");

  return (
    <PageShell title={chrome.title} back={chrome.back} width="content">
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

      <Card>
        <CardBody className="space-y-3">
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
                  : dateOutsideYear
                    ? tCommon("dateOutsideFiscalYear", {
                        year: fiscalYearLabel(fiscalYear!),
                      })
                    : undefined
            }
            // A hint, not an error: the day is a real one and the form takes
            // it. See the same field in the receipt wizard.
            hint={dateTooLate ? t("dateTooLate", { days: REIMBURSEMENT_DEADLINE_DAYS }) : undefined}
          >
            <DateInput
              min={fiscalYear?.fromDate}
              max={fiscalYear?.toDate}
              value={journeyDate}
              onChange={(e) => setJourneyDate(e.target.value)}
            />
          </Field>

          {/* Where the journey went, above the readings because that is the
              order it is remembered in, and because it is the half that makes
              the other half mean anything. Two readings prove a car moved; only
              the route says the moving was the section's errand. Skatteverket
              asks for both, and `claimBlocker` refuses to send one without the
              other.

              A list rather than a "from" and a "to": an errand that called at
              the wholesaler and then the Systembolaget before going home is one
              journey with four stops. Coming back is that first place typed
              again at the end, which is also what makes a 42 km reading agree
              with a shop 21 km away. */}
          <FieldGroup label={t("route.label")} hint={t("route.hint")} requirement="required">
            <div className="space-y-2">
              {stops.map((stop, i) => (
                <div key={i} className="flex items-center gap-2">
                  {/* Numbered rather than labelled "Från" and "Till": with a
                      variable number of rows only the first and last would have
                      a name, and the ones between are the point. */}
                  <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted">
                    {i + 1}
                  </span>
                  <Input
                    value={stop}
                    aria-label={t("route.stop", { n: i + 1 })}
                    placeholder={i === 0 ? t("route.firstPlaceholder") : t("route.nextPlaceholder")}
                    onChange={(e) => setStops(stops.map((s, j) => (j === i ? e.target.value : s)))}
                  />
                  <IconButton
                    tone="danger"
                    label={t("route.removeStop")}
                    // Two is the fewest a journey can have, so the last pair
                    // stays put. Emptying a row is still how you clear one.
                    disabled={stops.length <= 2}
                    onClick={() => setStops(stops.filter((_, j) => j !== i))}
                  >
                    <IconX className="size-4" />
                  </IconButton>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                type="button"
                onClick={() => setStops([...stops, ""])}
                disabled={stops.length >= MAX_STOPS}
                className="text-sm font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current disabled:opacity-40"
              >
                {t("route.addStop")}
              </button>
              {/* The common shape, in one press. Nearly every errand ends where
                  it began, and typing "Kårhuset, Lund" a second time is the kind
                  of retyping people skip. */}
              {stops.length < MAX_STOPS &&
                stops[0].trim() !== "" &&
                stops[stops.length - 1].trim() !== stops[0].trim() && (
                  <button
                    type="button"
                    onClick={() => setStops([...stops, stops[0]])}
                    className="text-sm font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
                  >
                    {t("route.addReturn")}
                  </button>
                )}
            </div>
          </FieldGroup>

          {/* The two readings, side by side because they are one measurement
              taken twice, and in the order they happen. */}
          <FieldGroup label={t("odometer.label")} hint={t("odometer.hint")} requirement="required">
            <div className="grid grid-cols-2 gap-3 sm:gap-5">
              {odometerField(t("odometer.start"), startText, setStartText)}
              {odometerField(t("odometer.end"), endText, setEndText)}
            </div>
            {/* Readings that are there but cannot be right, said in full. The
                ones simply not filled in yet are in the action bar's list. */}
            {(journeyBlocker === "notForward" || journeyBlocker === "noRate") && (
              <p className="mt-2 text-xs text-warning">{t(`blocker.${journeyBlocker}`)}</p>
            )}
          </FieldGroup>

          {/* The distance and what it comes to: neither typed, both shown. The
              subtraction is stated rather than only its answer, so somebody
              checking their own claim can see where the figure came from. */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-control bg-surface px-3.5 py-3">
            <span className="text-sm text-muted">
              {valued.km == null
                ? t("total")
                : t("sum", {
                    km: km(valued.km),
                    rate: valued.orePerKm == null ? "-" : money(valued.orePerKm / 100),
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

          {/* Three journeys are three claims, and the way back for somebody who
              picked the wrong item on the "Nytt utlägg" menu. */}
          <p className="text-xs text-muted">
            {t("perJourneyHint")}
            {!editing && (
              <>
                {" "}
                {t("otherType")}{" "}
                <Link
                  href="/expenses/new"
                  className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
                >
                  {t("otherTypeLink")}
                </Link>
              </>
            )}
          </p>
        </CardBody>
      </Card>

      <ActionBar
        summary={
          <>
            <span className="font-medium">
              <Amount value={grossSEK} />
            </span>
            <PaymentTag type="MILEAGE" />
            {resultUnits && (
              <span className="text-xs text-muted">{tWizard("goesTo", { resultUnits })}</span>
            )}
          </>
        }
        missing={missing}
        missingLabel={tWizard("missingLabel")}
        note={
          submittable && blocker ? (
            <SubmitBlockerNote
              blocker={blocker}
              paymentType="MILEAGE"
              className="text-xs text-warning"
            />
          ) : undefined
        }
        onSave={saveDraft}
        saveLabel={editing ? tWizard("save") : tWizard("saveDraft")}
        saveDisabled={!canPersist}
        saving={exit === "draft"}
        submit={
          submittable
            ? {
                label:
                  existing?.status === "CHANGES_REQUESTED"
                    ? tWizard("resubmit")
                    : tWizard("submit"),
                onClick: submitClaim,
                disabled: !canPersist || Boolean(blocker),
                loading: exit === "submit",
              }
            : undefined
        }
      />
    </PageShell>
  );
}
