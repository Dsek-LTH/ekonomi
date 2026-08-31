"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useReturnTo } from "@/components/shell/route-history";
import { useTranslations } from "next-intl";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { AmountInput } from "@/components/ui/amount-input";
import { PageShell } from "@/components/page-shell";
import { wizardChrome } from "./wizard-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DetailList, DetailRow } from "@/components/ui/detail-list";
import { Field, FieldGroup, Input, DateInput } from "@/components/ui/field";
import { Stepper } from "@/components/ui/stepper";
import { SubmitBlockerNote } from "@/components/submit-blocker-note";
import { IconCheck, IconLink } from "@/components/ui/icons";
import {
  PAYMENT_TYPES,
  REIMBURSEMENT_DEADLINE_DAYS,
  isLateReimbursement,
  isSubmittable,
  submitBlocker,
} from "@/lib/domain/status";
import { isCompleteDate, isFutureDate } from "@/lib/domain/date";
import { Amount } from "@/components/ui/amount";
// Still needed for the amounts that sit inside a translated sentence, where a
// React node cannot go. See `matchLead` below.
import { formatSEK } from "@/lib/ui/format";
import { parseSEK, sekToOre } from "@/lib/domain/money";
import type { CreateExpense, PatchExpense } from "@/lib/api/schemas/expense";
import { cancelsOut, isMatchable } from "@/lib/domain/matching";
import type { BankTransaction, CostCenter, Expense, PaymentType } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { useSelectOnce } from "@/lib/ui/use-select-once";
import { cn } from "@/lib/ui/utils";
import { AllocationEditor, makeRow } from "@/components/allocation-editor";
import { useLocalDraft } from "@/lib/ui/use-local-draft";
import type { AllocationRow } from "@/components/allocation-editor";

// The step keys, named by `expenses.wizard.step.<key>` in messages. The match
// step only exists for card purchases; a reimbursement goes straight from
// review to submit.

// The wizard asks two "pick one of these" questions: the payment type and the
// bank transaction to match. Both are a bordered card that fills with accent
// once chosen.
const optionCard = (selected: boolean) =>
  cn(
    "w-full rounded-xl border px-4 py-3 text-left transition-colors",
    selected ? "border-accent bg-accent-soft" : "border-border hover:bg-surface",
  );

/**
 * Which way the money goes.
 *
 * A question of its own rather than a minus in front of the amount, because a
 * phone's number pad has no minus key and never will (see
 * components/ui/amount-input.tsx). Every figure in the form is a magnitude and
 * this says what they mean, once, for the whole claim.
 */
type Direction = "out" | "return";

/** What the wizard is holding: every field it fills in, and nothing derived. */
type WizardDraft = {
  form: { title: string; purchaseDate: string; gross: string };
  direction: Direction;
  allocations: AllocationRow[];
  paymentType: PaymentType;
  matchId: string | null;
};

/**
 * Where a half-filled new utlägg waits.
 *
 * Versioned, so a draft written before this screen asked for something it now
 * needs is left where it is rather than loaded into a form that no longer has a
 * place to put it.
 */
const DRAFT_KEY = "utlagg:new-expense:v1";

// Shared by both "New expense" and "Edit expense": the same wizard, only
// pre-filled from `existing` when editing.
export default function NewExpenseClient({
  costCenters,
  bankTransactions,
  holdsCard,
  payoutClearing,
  payoutAccount,
  existing,
}: {
  costCenters: CostCenter[];
  bankTransactions: BankTransaction[];
  holdsCard: boolean;
  payoutClearing: string;
  payoutAccount: string;
  existing?: Expense;
}) {
  const returnTo = useReturnTo();
  const t = useTranslations("expenses.wizard");
  const tPayment = useTranslations("common.payment");
  const tNav = useTranslations("nav");
  const tReceipt = useTranslations("receipt");
  const tList = useTranslations("expenses");
  const { date } = useFormat();
  // The description opens focused. See the field on the first step.
  const selectOnce = useSelectOnce();
  const searchParams = useSearchParams();
  const notify = useNotify();
  const editing = !!existing;
  // Active cost centres, plus any this expense already uses (so an allocation on
  // a now-inactive cost centre stays selectable while editing).
  const usedCodes = new Set(existing?.allocations.map((a) => a.costCenterCode) ?? []);
  const selectableCostCenters = costCenters.filter((c) => c.active || usedCodes.has(c.code));
  // The "account for this" deep-link from the card purchases page (create only):
  // ?txn=<bankTxnId> pre-matches the card purchase and prefills amount/date.
  const presetTxn = (() => {
    if (editing) return undefined;
    const id = searchParams.get("txn");
    return id ? bankTransactions.find((t) => t.id === id) : undefined;
  })();
  const [step, setStep] = useState(0);
  /**
   * Everything the wizard is holding that the server has not been told about.
   *
   * One object rather than four pieces of state, because it is one thing: what
   * has been filled in so far. That is also what makes it storable, so a new
   * utlägg survives the tab being closed and the phone locking itself in the
   * queue at ICA. See below, and lib/ui/use-local-draft.ts.
   */
  const startingDraft: WizardDraft = existing
    ? {
        form: {
          title: existing.title,
          purchaseDate: existing.purchaseDate,
          // Signed in the database, a magnitude in the form. The sign is what
          // the toggle below holds instead.
          gross: String(Math.abs(existing.grossAmount)),
        },
        direction: existing.grossAmount < 0 ? "return" : "out",
        // The cost centre starts unpicked on a new utlägg. Choosing one is the
        // submitter's call, and defaulting to whichever happens to sort first
        // invites a wrong one going through unnoticed. submitBlocker refuses to
        // submit until each row has one.
        allocations: existing.allocations.length
          ? existing.allocations.map((a) =>
              makeRow(a.costCenterCode, String(Math.abs(a.amount)), a.comment ?? ""),
            )
          : [makeRow("", "")],
        paymentType: existing.paymentType,
        matchId: existing.matchedTransactionId ?? null,
      }
    : {
        form: presetTxn
          ? {
              title: presetTxn.description,
              purchaseDate: presetTxn.transactionDate,
              gross: String(Math.abs(presetTxn.amount)),
            }
          : { title: "", purchaseDate: "", gross: "" },
        // A card purchase is money leaving; a credit on the card is one coming
        // back. The transaction says which, so the wizard does not have to ask.
        direction: presetTxn && presetTxn.amount > 0 ? "return" : "out",
        allocations: [makeRow("", presetTxn ? String(Math.abs(presetTxn.amount)) : "")],
        paymentType: holdsCard ? "CARD" : "REIMBURSEMENT",
        matchId: presetTxn ? presetTxn.id : null,
      };

  /**
   * Kept in this browser until the utlägg exists on the server.
   *
   * Only for a new one. An utlägg being edited is already the server's, and a
   * local copy that outlived somebody else's change would put a stale figure
   * back on the screen, which is worse than the lost draft it would be saving.
   *
   * A card purchase started from a bank transaction gets a key of its own, so
   * the half-filled claim for one payment cannot be restored on top of another.
   * The version in the key is what makes an old draft, written before this
   * screen asked for something it now needs, simply not load.
   *
   * The receipt is the one thing that cannot come along: a picked file is not
   * something a browser can be asked to keep. Everything typed survives; the
   * file has to be chosen again.
   */
  const draftKey = presetTxn ? `${DRAFT_KEY}:${presetTxn.id}` : DRAFT_KEY;
  const [draft, setDraft, , forgetDraft] = useLocalDraft<WizardDraft>(
    draftKey,
    startingDraft,
    !existing,
  );
  const { form, direction, allocations, paymentType, matchId } = draft;

  /**
   * Which way, chosen before anything else is filled in.
   *
   * A return is money coming back to the section, and the only way that
   * happens is a refund landing on the card it was paid from: a member does not
   * hand the section money through an utlägg. So it is offered to somebody
   * holding the card and to nobody else, and choosing it settles the payment
   * type there and then rather than leaving a combination for the form to
   * refuse further down.
   */
  const canReturn = holdsCard || direction === "return";
  const chooseDirection = (next: Direction) =>
    setDraft((d) => ({
      ...d,
      direction: next,
      paymentType: next === "return" ? "CARD" : d.paymentType,
    }));

  // CARD is only offered to card holders; the expense being edited keeps its
  // type as an option even if the user no longer holds a card. A return is
  // narrower still: it is money coming back to the card, so it leaves one
  // answer here, which the group below says out loud rather than showing as a
  // lone card nobody chose.
  //
  // And when this wizard was opened to account for one particular purchase on
  // the card, the payment type is not a choice at all: that money has already
  // left the section's account. Offering "eget utlägg" beside a purchase the
  // section has already paid for is offering to pay for it a second time, into
  // the member's own account, which is what this used to do, quietly, because
  // the transaction stayed matched to the utlägg through the switch. Someone
  // who meant to claim their own money back wants a new utlägg, not this one.
  //
  // MILEAGE is never among them, and is not offered here at all. Which *form*
  // you need is a different question from how this purchase was paid, and it is
  // answered before either form exists, on the "Nytt utlägg" menu. See
  // components/new-expense-menu.tsx. It was a third card in the group below for
  // a while: a door standing among two switches, at the bottom of a step, which
  // discarded everything typed above it when taken.
  const paymentTypes =
    presetTxn || direction === "return"
      ? (["CARD"] as PaymentType[])
      : PAYMENT_TYPES.filter(
          (pt) =>
            pt !== "MILEAGE" &&
            (holdsCard || pt !== "CARD" || existing?.paymentType === "CARD"),
        );
  const patchDraft = <K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setForm = (value: WizardDraft["form"]) => patchDraft("form", value);
  const setAllocations = (value: AllocationRow[]) => patchDraft("allocations", value);
  const setMatchId = (value: string | null) => patchDraft("matchId", value);

  // The step flow depends on payment type: a reimbursement skips "Matcha".
  // Uploading isn't among them. The receipt panel beside the form is where a
  // receipt goes and where it then stays, so it needs no step of its own.
  const stepKeys = paymentType === "CARD"
    ? (["review", "match", "submit"] as const)
    : (["review", "submit"] as const);
  const stepLabels = stepKeys.map((k) => t(`step.${k}`));
  const cur = stepKeys[step] ?? stepKeys[stepKeys.length - 1];
  // One busy scope for the whole wizard: saving and submitting, and the
  // receipt upload inside them, block the same footer.
  const { pending, mutate } = useMutation();
  const saving = pending === "save";
  const saveLabel = editing ? t("save") : t("saveDraft");
  // Which of the two exits is running. `saving` can't tell them apart, since both
  // write the same draft through the same key first, and a spinner on both
  // buttons at once would claim the app is doing twice the work it is. Cleared
  // only on failure: on success the page is leaving, and a button that goes
  // idle while you're still looking at the old screen reads as nothing having
  // happened.
  const [exit, setExit] = useState<"draft" | "submit" | null>(null);

  // The utlägg's own id, once there is a row for it. Null all the way through a
  // new utlägg until the moment it is saved. See `persist`. The id and not the
  // reference: an utlägg has no reference until it is submitted (see
  // lib/domain/reference.ts), and every route this page calls is keyed on the id.
  const [draftId, setDraftId] = useState<string | null>(existing?.id ?? null);
  // The receipt already in the archive, if any. Only an utlägg being edited
  // starts with one.
  const [receiptId, setReceiptId] = useState<string | null>(existing?.receiptId ?? null);
  const [uploadedMime, setUploadedMime] = useState<string>(existing?.receiptMimeType ?? "");
  const [uploadedName, setUploadedName] = useState<string>(existing?.receiptId ? tReceipt("alt") : "");

  // The receipt as picked, before it is anywhere but this browser. Dropping a
  // file used to create the utlägg and upload on the spot, which meant walking
  // away from a half-filled wizard left a bare row and a stored file behind,
  // and every abandoned attempt was something a bookkeeper later had to look at
  // and dismiss. Now the file waits here and goes up with the save, so leaving
  // the page leaves nothing.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // A local URL to show it by, since there is no /api/receipts/:id to read it
  // from yet. Revoked when it is replaced and when the page goes, because otherwise
  // the browser holds the file for as long as the tab lives.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // One cleanup covers both ways a preview ends, a second file replacing the
  // first and the page going away, because either is this value changing.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleFile(file: File) {
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadedMime(file.type);
    setUploadedName(file.name);
  }

  // Whether there is a receipt, which is the only form of the question this
  // page ever asks. Every gate here (continue, save, submit) wants "has the
  // reader produced one", not "is one in the archive". Those were the same
  // thing while the upload happened on drop; they aren't now, and asking for
  // `receiptId` gets a "no" while the receipt is on screen.
  const hasReceipt = Boolean(receiptId || pendingFile);

  // Put the waiting receipt in the archive, if there is one. Part of saving
  // now, so it can fail the save: an utlägg whose receipt didn't make it is not
  // saved but half saved, and the next attempt tries the upload again against
  // the row that by then already exists.
  async function writeReceipt(id: string): Promise<boolean> {
    if (!pendingFile) return true;
    const fd = new FormData();
    fd.append("file", pendingFile);
    // The Receipt row the route answers with, named rather than cast field by
    // field at each use.
    const receipt = await mutate<{ id: string; mimeType?: string; filename?: string }>(
      `/api/expenses/${id}/receipts`,
      { key: "save", body: fd, error: t("uploadFailed"), refresh: false },
    );
    if (!receipt) return false;
    setReceiptId(receipt.id);
    setUploadedMime(receipt.mimeType ?? pendingFile.type);
    setUploadedName(receipt.filename ?? pendingFile.name);
    // It is in the archive now, so the panel reads it from there. Dropping the
    // preview is what makes that happen. Kept, it would go on pointing at a
    // local copy that the effect above is about to revoke.
    setPendingFile(null);
    setPreviewUrl(null);
    return true;
  }

  const candidates = useMemo(() => {
    const gross = parseSEK(form.gross);
    // A return is money coming back, so it matches an incoming (positive) bank
    // row; an ordinary purchase matches an outgoing (negative) one.
    const incoming = gross < 0;
    // Unmatched transactions, plus the one already matched to this expense (so
    // it stays visible/selected while editing). The near misses are kept and
    // shown disabled: seeing a 249,50 purchase sitting there is what tells you
    // the amount was mistyped, which an empty list never would.
    return bankTransactions
      .filter(
        (txn) =>
          (!txn.matchedExpenseId || txn.id === matchId) &&
          (incoming ? txn.amount > 0 : txn.amount < 0),
      )
      .map((txn) => ({ txn, selectable: cancelsOut(txn.amount, gross) }))
      .sort(
        (a, b) =>
          // Selectable first, then closest by size.
          Number(b.selectable) - Number(a.selectable) ||
          Math.abs(Math.abs(a.txn.amount) - Math.abs(gross)) -
            Math.abs(Math.abs(b.txn.amount) - Math.abs(gross)),
      )
      .slice(0, 5);
  }, [form.gross, bankTransactions, matchId]);

  // A match only counts while it still cancels the amount out. Editing the
  // amount afterwards silently invalidates it, and the server rejects it too.
  const matchedTxn = bankTransactions.find((t) => t.id === matchId);
  const matchDone = !!matchedTxn && cancelsOut(matchedTxn.amount, parseSEK(form.gross));
  // The date field is a mask, so it can be left half-typed ("2026", "2026-07").
  // Empty is a draft in progress; a partial date is an error to point at.
  const dateComplete = isCompleteDate(form.purchaseDate);
  const dateIncomplete = form.purchaseDate !== "" && !dateComplete;
  // Nothing has been bought tomorrow. Almost always a mistyped year, so it's
  // pointed at here rather than left for the server to refuse on save.
  const dateInFuture = isFutureDate(form.purchaseDate);
  // Past the 60-day deadline for an eget utlägg. Depends on the payment type,
  // which is picked further down this same step, so switching to "Eget utlägg"
  // lights this up on an old receipt then and there.
  const dateTooLate = isLateReimbursement(form.purchaseDate, paymentType);
  // Enough to move on: a receipt, an amount (either sign, but not zero), a
  // whole date that has already happened and is still in time, and a cost
  // centre on every row.
  const filledForm =
    hasReceipt &&
    parseSEK(form.gross) !== 0 &&
    dateComplete &&
    !dateInFuture &&
    !dateTooLate &&
    allocations.length > 0 &&
    allocations.every((a) => a.costCenterCode);
  // A submitted/approved expense can be edited but not re-submitted from here.
  const submittable = !existing || isSubmittable(existing.status);

  /**
   * What the figures in the form mean, as a signed number.
   *
   * The form holds magnitudes and the toggle holds the direction; every reader
   * below this line wants the two put together, because that is what an utlägg
   * is worth and what the database stores. The one multiplication lives here so
   * no screen has to remember to do it.
   */
  const sign = direction === "return" ? -1 : 1;
  const magnitude = parseSEK(form.gross);
  const grossSEK = sign * magnitude;
  const signedAllocations = allocations.map((a) => ({
    ...a,
    value: sign * parseSEK(a.amount),
  }));

  // Saving a draft is allowed with fields still empty, but not with a partial
  // date, which would be stored as 1 January of the year typed so far, and not
  // with one that hasn't happened yet, which the server refuses anyway. And not
  // before the receipt: an utlägg is a claim about a purchase, and the receipt
  // is what makes it one. It no longer has to be uploaded by then: a file
  // waiting in the browser counts, and goes up as part of the save.
  const canPersist =
    form.title.trim() !== "" &&
    !dateIncomplete &&
    !dateInFuture &&
    !dateTooLate &&
    hasReceipt &&
    !saving;
  // Everything required to send for attest (complete details + match/payout);
  // `blocker` names the first missing piece, for the hint below.
  const blocker = submitBlocker({
    title: form.title,
    purchaseDate: form.purchaseDate,
    grossAmount: grossSEK,
    paymentType,
    hasReceipt,
    // Only a match that still cancels out counts, so a stale one shows the
    // "match it first" hint rather than letting submit fail at the server.
    matchedTransactionId: matchDone ? matchId ?? undefined : undefined,
    submitterHasPayout: Boolean(payoutClearing && payoutAccount),
    allocations: signedAllocations.map((a) => ({
      amount: a.value,
      costCenterCode: a.costCenterCode,
    })),
  });

  // Everything this wizard writes, in the order it has to happen: the utlägg
  // itself, then its receipt, then the reviewed fields, then the bank match for
  // a card purchase. Nothing before this, since a wizard that was opened and left
  // alone has written nothing at all.
  //
  // Returns the utlägg's id rather than a bare success, because on a first save
  // the caller has no other way to know it: `draftId` is set here, and state
  // set inside a handler isn't readable from the rest of that same handler.
  async function persist(): Promise<string | null> {
    let id = draftId;
    if (!id) {
      // Typed on the way out as well as back: `CreateExpense` is the schema the
      // route validates against, so a field renamed on one side stops compiling
      // on the other.
      const create: CreateExpense = {
        paymentType,
        title: "",
        // Only ever with the card purchase it belongs to. The type is locked
        // to CARD whenever there is a presetTxn, so this reads as belt and
        // braces. It is the same rule the route refuses on (isMatchable),
        // written where the body is built rather than left implied by a
        // condition three hundred lines up.
        matchedTransactionId: isMatchable(paymentType) ? (presetTxn?.id ?? null) : null,
      };
      const created = await mutate<{ id: string }>("/api/expenses", {
        key: "save",
        body: create,
        error: t("createFailed"),
        // Nothing on screen shows it yet. The steps after this one do.
        refresh: false,
      });
      if (!created) return null;
      id = created.id;
      setDraftId(id);
    }
    if (!(await writeReceipt(id))) return null;
    // Öre, both of them. The gross and the rows that have to sum to it cross
    // the wire in the same unit as each other and as the columns they land in.
    // The rows used to go as kronor, which made a figure a hundred times too
    // small look like a distribution that didn't balance. `PatchExpense` is
    // what now says so in a form the compiler reads.
    const patch: PatchExpense = {
      title: form.title,
      purchaseDate: form.purchaseDate || null,
      grossAmount: sekToOre(grossSEK),
      allocations: signedAllocations.map((a) => ({
        costCenterCode: a.costCenterCode,
        amount: sekToOre(a.value),
        comment: a.comment || undefined,
      })),
      paymentType,
    };
    const saved = await mutate(`/api/expenses/${id}`, {
      key: "save",
      method: "PATCH",
      body: patch,
      error: t("saveFailed"),
    });
    if (!saved) return null;
    if (paymentType !== "CARD") return id;
    const matched = await mutate(`/api/expenses/${id}/match`, {
      key: "save",
      body: { transactionId: matchId },
      error: t("matchSaveFailed"),
    });
    return matched === null ? null : id;
  }

  // Both exits from the wizard save first, then land on the expense itself.
  function done(id: string) {
    // The utlägg exists on the server now, so the copy in this browser is spent
    // and must not be restored over it the next time somebody starts a new one.
    // `forget` rather than `clear`: the form is still on the screen for the
    // frame before the page changes, and blanking it there reads as work lost.
    forgetDraft();
    // Replaces the wizard's history entry rather than pushing past it: the
    // form has been submitted, and Back leading into a spent one is not a way
    // back to anything. See useReturnTo.
    returnTo(`/expenses/${id}`);
  }

  async function saveDraft() {
    setExit("draft");
    const id = await persist();
    if (!id) {
      setExit(null);
      return;
    }
    notify.success(editing ? t("savedChanges") : t("savedDraft"));
    done(id);
  }

  async function submitExpense() {
    setExit("submit");
    const id = await persist();
    if (!id) {
      setExit(null);
      return;
    }
    const sent = await mutate(`/api/expenses/${id}/transition`, {
      key: "save",
      body: { action: "submit" },
      error: t("submitFailed"),
    });
    if (!sent) {
      setExit(null);
      return;
    }
    notify.success(t("submitted"));
    done(id);
  }

  const chrome = wizardChrome({
    existing,
    t,
    draftLabel: t("draftLabel"),
    listLabel: tNav("expenses"),
  });

  return (
    <PageShell
      title={chrome.title}
      description={chrome.description}
      back={chrome.back}
      width="content"
    >
      <Stepper steps={stepLabels} current={step} />

      {/* The panel takes the receipt as well as showing it: with none uploaded
          yet it stands open beside the form as the dropzone, which is why this
          wizard has no upload step of its own. */}
      <ReceiptPanelSource
        receiptId={receiptId}
        previewUrl={previewUrl}
        mimeType={uploadedMime}
        filename={uploadedName || tReceipt("alt")}
        onFile={handleFile}
        uploading={saving}
      />

      {/* Step 1: the details, beside the receipt */}
      {cur === "review" && (
        <Card>
          <CardBody className="space-y-5">
            {/* The first thing asked for, so the first thing focused: this
                step opens with the receipt beside it and one question to
                answer, and reaching for the mouse to answer it is a step
                nobody needs. Selected as well as focused, which only matters
                when an existing utlägg is being edited, because then the title is
                already there and typing should replace it. */}
            {/* Before anything else, because it is the question everything
                below it depends on: what the figures mean, which payment types
                are left, and which bank transactions can match. Asked in the
                same shape as the payment type further down, since it is the
                same kind of question and two shapes for one kind is how a form
                stops reading as one form.

                Not asked at all of somebody with no card, who cannot file a
                return: the whole group goes rather than standing there with
                one answer available. */}
            {canReturn && (
              <FieldGroup label={t("direction")}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["out", "return"] as Direction[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => chooseDirection(d)}
                      className={optionCard(direction === d)}
                      aria-pressed={direction === d}
                    >
                      <span className="block text-sm font-medium">
                        {t(d === "out" ? "directionOut" : "directionReturn")}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {t(d === "out" ? "directionOutHint" : "directionReturnHint")}
                      </span>
                    </button>
                  ))}
                </div>
              </FieldGroup>
            )}

            <Field label={t("description")}>
              <Input
                autoFocus
                onFocus={selectOnce}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>

            {/* Two up at every width, not only from sm. A date and an amount
                are short fields, ten characters and eight, and a column of
                full-width boxes on a phone makes a four-field form look like a
                long one and pushes the fördelning below the fold. `gap-3`
                rather than `gap-5` while they are sharing 329px. */}
            <div className="grid grid-cols-2 gap-3 sm:gap-5">
              <Field
                label={t("purchaseDate")}
                error={
                  dateIncomplete
                    ? t("dateIncomplete")
                    : dateInFuture
                      ? t("dateFuture")
                      : dateTooLate
                        ? t("dateTooLate", { days: REIMBURSEMENT_DEADLINE_DAYS })
                        : undefined
                }
              >
                <DateInput
                  value={form.purchaseDate}
                  onChange={(e) =>
                    setForm({ ...form, purchaseDate: e.target.value })
                  }
                />
              </Field>
              {/* The keypad, the guard and the separator all live in
                  AmountInput now, including the sign button, which is the only
                  way to reach a negative amount on a phone: no mobile numeric
                  keypad has a minus key. A return is the same utlägg with the
                  sign flipped, so it is a case this field has to allow. */}
              {/* FieldGroup, not Field: the label carries a control of its
                  own, and a <label> forwards a click anywhere in its box to
                  the first labelable element inside it, which here would be
                  one of the two direction buttons.

                  The direction rides the label's line rather than standing
                  above the box, so this cell is exactly as tall as the date
                  beside it. Which way the money goes is not a minus typed into
                  the figure: no phone number pad has the key, and a word says
                  it where a character has to be noticed. */}
              <Field label={t("amount")}>
                <AmountInput
                  value={form.gross}
                  onChange={(gross: string) => {
                    setForm({ ...form, gross });
                    // A single row is the whole amount, so it follows it.
                    if (allocations.length === 1) {
                      setAllocations([{ ...allocations[0], amount: gross }]);
                    }
                  }}
                />
                {/* What the unusual answer means, in the words somebody would
                    use for it. Only when it is chosen, so the ordinary utlägg
                    carries no extra line. */}
                {direction === "return" && magnitude > 0 && (
                  <p className="mt-1 text-xs text-danger">
                    {t("returnMeans", { amount: formatSEK(magnitude) })}
                  </p>
                )}
              </Field>
            </div>

            <FieldGroup label={t("distribution")}>
              <AllocationEditor
                costCenters={selectableCostCenters}
                grossAmount={magnitude}
                value={allocations}
                onChange={setAllocations}
              />
            </FieldGroup>

            <FieldGroup label={t("paymentType")}>
              {/* Said out loud, because a group that offers one answer reads
                  as a group that is broken. */}
              {presetTxn ? (
                <p className="mb-3 text-xs text-muted">{t("paymentTypeFixed")}</p>
              ) : direction === "return" ? (
                <p className="mb-3 text-xs text-muted">{t("paymentTypeReturn")}</p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {paymentTypes.map((pt) => (
                  <button
                    key={pt}
                    onClick={() => patchDraft("paymentType", pt)}
                    className={optionCard(paymentType === pt)}
                  >
                    <span className="block text-sm font-medium">
                      {tPayment(`${pt}.label`)}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {tPayment(`${pt}.description`)}
                    </span>
                  </button>
                ))}
              </div>
            </FieldGroup>
            {/* The receipt is a condition like any other, and the one that
                isn't in this card. Without saying so, Fortsätt is a dead
                button with its reason off at the edge of the screen. */}
            {!hasReceipt && (
              <p className="text-xs text-warning">{t("receiptRequired")}</p>
            )}
            {/* No back: this is the first step now. */}
            <StepFooter onSave={saveDraft} saveLabel={saveLabel} saveDisabled={!canPersist} saving={exit === "draft"}>
              <Button disabled={!filledForm} onClick={() => setStep(1)}>{t("continue")}</Button>
            </StepFooter>
          </CardBody>
        </Card>
      )}

      {/* Step 2: match (card purchases only) */}
      {cur === "match" && (
        <Card>
          <CardBody className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">{t("matchTitle")}</h2>
              <p className="mt-1 text-sm text-muted">
                {t("matchLead", { amount: formatSEK(Math.abs(grossSEK)) })}
              </p>
            </div>
            <ul className="space-y-2.5">
                  {candidates.map(({ txn, selectable }, i) => {
                    const selected = matchId === txn.id;
                    const suggested = selectable && i === 0;
                    return (
                      <li key={txn.id}>
                        <button
                          disabled={!selectable}
                          title={selectable ? undefined : t("amountMismatch")}
                          onClick={() => setMatchId(txn.id)}
                          className={cn(
                            optionCard(selected),
                            "flex items-center gap-3",
                            !selectable && "cursor-not-allowed opacity-45 hover:bg-transparent",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-9 items-center justify-center rounded-full",
                              selected
                                ? "brand-fill text-on-brand"
                                : "bg-surface text-muted",
                            )}
                          >
                            <IconLink className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">
                                {txn.description}
                              </p>
                              {suggested && (
                                <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                                  {t("suggested")}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted">
                              {date(txn.transactionDate)}
                              {!selectable && ` – ${t("otherAmount")}`}
                            </p>
                          </div>
                          <Amount value={txn.amount} />
                        </button>
                      </li>
                    );
                  })}
              {candidates.length === 0 && (
                <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
                  {t("noCandidates")}
                </li>
              )}
            </ul>
            <p className="text-xs text-muted">{tList("noMatchHint")}</p>
            <StepFooter onBack={() => setStep(0)} onSave={saveDraft} saveLabel={saveLabel} saveDisabled={!canPersist} saving={exit === "draft"}>
              <Button disabled={!matchDone} onClick={() => setStep(2)}>
                {t("continue")}
              </Button>
            </StepFooter>
          </CardBody>
        </Card>
      )}

      {/* Final step: review and submit */}
      {cur === "submit" && (
        <Card>
          <CardBody className="space-y-5">
            <h2 className="text-base font-semibold">{t("reviewTitle")}</h2>
            <DetailList>
              <DetailRow label={t("description")} value={form.title} />
              <DetailRow label={t("date")} value={date(form.purchaseDate)} />
              <DetailRow label={t("amount")} value={<Amount value={grossSEK} signed />} />
              {allocations.map((a, i) => (
                <DetailRow
                  key={a.id}
                  label={i === 0 ? t("distribution") : ""}
                  value={<>{a.costCenterCode} – <Amount value={signedAllocations[i].value} signed /></>}
                />
              ))}
              <DetailRow label={t("paymentType")} value={tPayment(`${paymentType}.label`)} />
              {paymentType === "CARD" ? (
                <DetailRow
                  label={t("match")}
                  value={bankTransactions.find((tx) => tx.id === matchId)?.description ?? "–"}
                />
              ) : (
                <DetailRow
                  label={t("payoutTo")}
                  value={
                    payoutClearing && payoutAccount
                      ? `${payoutClearing} – ${payoutAccount}`
                      : t("payoutMissing")
                  }
                />
              )}
            </DetailList>

            <div className="flex items-center gap-2 rounded-xl bg-surface px-3.5 py-2.5 text-sm text-muted">
              <IconCheck className="size-4 shrink-0 text-success" />
              {t("goesTo", {
                resultUnits:
                  [...new Set(
                    allocations
                      .map((a) => costCenters.find((c) => c.code === a.costCenterCode)?.resultUnit)
                      .filter(Boolean),
                  )].join(", ") || t("resultUnitConcerned"),
              })}
            </div>

            {submittable && blocker && (
              <SubmitBlockerNote
                blocker={blocker}
                paymentType={paymentType}
                className="text-xs text-warning"
              />
            )}
            <StepFooter onBack={() => setStep(step - 1)} onSave={saveDraft} saveLabel={saveLabel} saveDisabled={!canPersist} saving={exit === "draft"}>
              {submittable && !blocker && (
                <Button
                  onClick={submitExpense}
                  loading={exit === "submit"}
                  disabled={!canPersist}
                >
                  {existing?.status === "CHANGES_REQUESTED" ? t("resubmit") : t("submit")}
                </Button>
              )}
            </StepFooter>
          </CardBody>
        </Card>
      )}
    </PageShell>
  );
}

// Every wizard step ends the same way: back on the left, "save draft" and the
// step's own primary action on the right.
function StepFooter({ onBack, onSave, saveLabel, saveDisabled, saving, children }: {
  /** Omitted on the first step, which has nowhere to go back to. */
  onBack?: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  /** The draft save this footer owns is in flight, not the step's own action. */
  saving: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations("expenses.wizard");
  return (
    <div className="flex flex-wrap justify-between gap-2.5 pt-1">
      {onBack ? (
        <Button variant="secondary" onClick={onBack}>
          {t("back")}
        </Button>
      ) : (
        // Keeps the save/primary pair against the right edge, where they are on
        // every other step.
        <span />
      )}
      <div className="flex gap-2.5">
        <Button variant="secondary" onClick={onSave} loading={saving} disabled={saveDisabled}>
          {saveLabel}
        </Button>
        {children}
      </div>
    </div>
  );
}
