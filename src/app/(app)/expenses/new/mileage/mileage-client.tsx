"use client";

// Milersättning: one journey per claim (three drives are three claims, each attested on its own cost centre).
// No receipt, no amount to type: the claimant gives the odometer at each end and the money is the distance at the schablon (lib/mileage/).
// The journey is printed on the utläggsräkning (lib/expense/document.ts), which is the claim's underlag. Laid out like the utlägg form, without a match section.
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useReturnTo } from "@/components/shell/route-history";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { PageShell } from "@/components/page-shell";
import Link from "next/link";
import { PaymentTag } from "@/components/ui/payment-tag";
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

/** What an odometer field holds, as text because "12 300," is mid-typing. Null for "nothing typed", since 0 is a real reading. */
const readOdometer = (text: string): number | null => {
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Whether a string is on its way to being a reading. Anything else is not taken (as `isAmountInput` for money). */
const isOdometerInput = (text: string): boolean => /^\d{0,7}([.,]\d?)?$/.test(text);

/** A stored reading back into the text the field holds, with the comma a
 *  Swedish reader would have typed it with. */
const showOdometer = (km: number | null | undefined): string =>
  km == null ? "" : String(km).replace(".", ",");

/** As many stops as the API takes (PatchExpense.journeyStops). */
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
  /** The claim being edited, when opened from one (the edit page picks the form on `paymentType`). */
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
  /** Every place the car stopped, in order. Two empty rows to start, the fewest a journey has. Plain strings keyed by index: order is the meaning. */
  const [stops, setStops] = useState<string[]>(() =>
    existing?.mileage?.stops.length ? existing.mileage.stops : ["", ""],
  );
  // Unpicked to start with, as in the ordinary wizard.
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

  // What the journey comes to, with the server's function: the amount is never typed here, so this is where the claimant sees it.
  const valued = valueJourney(journey, rates);
  const grossSEK = oreToSEK(valued.ore ?? 0);
  const journeyBlocker = claimBlocker(journey, rates);

  // The date field is a mask: empty is a draft in progress, a partial date is an error.
  const dateIncomplete = journeyDate !== "" && !isCompleteDate(journeyDate);
  const dateInFuture = isFutureDate(journeyDate);
  // In the year picked in the header, as in the receipt wizard.
  const dateOutsideYear =
    journeyDate !== (existing?.purchaseDate ?? "") && outsideFiscalYear(fiscalYear, journeyDate);
  // Past the filing deadline, which a milersättning has as an eget utlägg does. Said under the field, since nobody can fix it by filling something else in.
  // A warning, not a wall: sending is stopped by `blocker`.
  const dateTooLate = isLateReimbursement(journeyDate, "MILEAGE");

  const blocker = submitBlocker({
    title,
    purchaseDate: journeyDate,
    grossAmount: grossSEK,
    paymentType: "MILEAGE",
    // No receipt on a milersättning: `mileageBlocker` stands in for the receipt check (see submitBlocker).
    hasReceipt: false,
    mileageBlocker: journeyBlocker,
    submitterHasPayout: Boolean(payoutClearing && payoutAccount),
    // False here: a dispens is granted against an existing utlägg, by somebody else (the skattmästare).
    deadlineWaived: false,
    allocations: allocations.map((a) => ({
      amount: parseSEK(a.amount),
      costCenterCode: a.costCenterCode,
    })),
  });

  // A draft may be saved with readings missing, but not without a title, with a half-typed date (stored as 1 January),
  // a future day, or past the deadline (PATCH refuses it).
  const canPersist =
    title.trim() !== "" && !dateIncomplete && !dateInFuture && !dateOutsideYear && !saving;
  // An attested claim can be corrected but not re-sent from this form.
  const submittable = !existing || isSubmittable(existing.status);

  /** Everything this form writes, in order. The amount is not sent: the server works it out from the readings
   * and the rate on the journey's day (PatchExpense.odometerStart). */
  async function persist(): Promise<string | null> {
    let id = draftId;
    if (!id) {
      const create: CreateExpense = {
        paymentType: "MILEAGE",
        title: "",
        // Nothing to match: isMatchable refuses a match on anything but a card purchase.
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
    // Replaces the wizard's entry rather than pushing past it, as the claim wizard's `done`.
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
      {/* Not type="number": it refuses the space a six-digit reading is typed with and fights the comma on a Swedish keyboard. */}
      <Input
        autoFocus={autoFocus}
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          if (!isOdometerInput(e.target.value)) return;
          onChange(e.target.value);
        }}
        // Shown with the comma a Swedish reader writes, on blur rather than per keystroke.
        onBlur={() => {
          const shown = commaForm(value);
          if (shown !== value) onChange(shown);
        }}
      />
    </Field>
  );

  const pageTitle = !existing
    ? t("newTitle")
    : existing.reference
      ? t("editTitle", { id: existing.reference })
      : t("editTitleDraft");
  const back = existing ? `/expenses/${existing.id}` : "/expenses";

  // What still has to be filled in before this can be sent, by name, in the order the page asks.
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
    <PageShell title={pageTitle} back={back} width="content">
      {/* The panel shows the utläggsräkning once there is a draft. It never takes an upload: there is nothing to upload on this form. */}
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
            hint={dateTooLate ? t("dateTooLate", { days: REIMBURSEMENT_DEADLINE_DAYS }) : undefined}
          >
            <DateInput
              min={fiscalYear?.fromDate}
              max={fiscalYear?.toDate}
              value={journeyDate}
              onChange={(e) => setJourneyDate(e.target.value)}
            />
          </Field>

          {/* The route above the readings: two readings prove a car moved, only the route says it was the section's errand (`claimBlocker` requires both). */}
          <FieldGroup label={t("route.label")} hint={t("route.hint")} requirement="required">
            <div className="space-y-2">
              {stops.map((stop, i) => (
                <div key={i} className="flex items-center gap-2">
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
                    // Two is the fewest a journey has, so the last pair stays put.
                    disabled={stops.length <= 2}
                    onClick={() => setStops(stops.filter((_, j) => j !== i))}
                  >
                    <IconX className="size-4" />
                  </IconButton>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Button
                variant="link"
                type="button"
                onClick={() => setStops([...stops, ""])}
                disabled={stops.length >= MAX_STOPS}
                className="text-sm"
              >
                {t("route.addStop")}
              </Button>
              {stops.length < MAX_STOPS &&
                stops[0].trim() !== "" &&
                stops[stops.length - 1].trim() !== stops[0].trim() && (
                  <Button
                    variant="link"
                    type="button"
                    onClick={() => setStops([...stops, stops[0]])}
                    className="text-sm"
                  >
                    {t("route.addReturn")}
                  </Button>
                )}
            </div>
          </FieldGroup>

          <FieldGroup label={t("odometer.label")} hint={t("odometer.hint")} requirement="required">
            <div className="grid grid-cols-2 gap-3 sm:gap-5">
              {odometerField(t("odometer.start"), startText, setStartText)}
              {odometerField(t("odometer.end"), endText, setEndText)}
            </div>
            {(journeyBlocker === "notForward" || journeyBlocker === "noRate") && (
              <p className="mt-2 text-xs text-warning">{t(`blocker.${journeyBlocker}`)}</p>
            )}
          </FieldGroup>

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
