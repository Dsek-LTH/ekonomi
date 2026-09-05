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
import { IconCheck } from "@/components/ui/icons";
import {
  REIMBURSEMENT_DEADLINE_DAYS,
  isLateReimbursement,
  isSubmittable,
  submitBlocker,
} from "@/lib/domain/status";
import { isCompleteDate, isFutureDate } from "@/lib/domain/date";
import { Amount } from "@/components/ui/amount";
// Still needed for the amounts that sit inside a translated sentence, where a
// React node cannot go.
import { formatSEK } from "@/lib/ui/format";
import { parseSEK, sekToOre } from "@/lib/domain/money";
import type { CreateExpense, PatchExpense } from "@/lib/api/schemas/expense";
import { cancelsOut, isMatchable, matchCandidates } from "@/lib/domain/matching";
import type { BankTransaction, CostCenter, Expense, PaymentType } from "@/lib/domain/types";
import { PaymentIcon, PaymentTag } from "@/components/ui/payment-tag";
import { MatchStep } from "./match-step";
import { optionCard, StepFooter } from "./step-chrome";
import { dropKeptFile, keepFile, readKeptFile } from "@/lib/ui/kept-file";
import { useFormat } from "@/lib/ui/use-format";
import { useSelectOnce } from "@/lib/ui/use-select-once";
import { AllocationEditor, makeRow } from "@/components/allocation-editor";
import { useLocalDraft } from "@/lib/ui/use-local-draft";
import type { AllocationRow } from "@/components/allocation-editor";

// The step keys, named by `expenses.wizard.step.<key>` in messages. The match
// step only exists for card purchases; a reimbursement goes straight from
// review to submit.

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
  const tNav = useTranslations("nav");
  const tReceipt = useTranslations("receipt");
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
   * The picked receipt is kept too, under the same key, but in IndexedDB
   * rather than here: a file is a Blob and localStorage holds strings. See
   * lib/ui/kept-file.ts. The two halves are written and forgotten together, so
   * what the wizard is holding survives a reload whole or not at all.
   */
  const draftKey = presetTxn ? `${DRAFT_KEY}:${presetTxn.id}` : DRAFT_KEY;
  const [draft, setDraft, , forgetDraft] = useLocalDraft<WizardDraft>(
    draftKey,
    startingDraft,
    !existing,
  );
  const { form, direction, allocations, paymentType, matchId } = draft;

  /**
   * What is being claimed, asked once instead of twice.
   *
   * The direction and the payment type used to be two groups of option cards
   * with three fields between them, one at the top of this step and one at the
   * bottom. They are the same question: a return is money coming back, and the
   * only way that happens is a refund landing on the card it was paid from, so
   * "retur" already forced CARD and left the group below it with one answer.
   * Three combinations exist, and this asks for one of them.
   *
   * It also has to come first, which is why the split was a bug and not only a
   * repetition. The payment type decides whether the 60-day deadline applies,
   * whether a payout account is needed, and whether the wizard has a Matcha
   * step at all. Asked at the bottom, it meant typing a four-month-old date for
   * a card purchase and being told, by a field three groups above the answer,
   * that the claim was too old to file. Continue was dead until you scrolled
   * down and changed something the form had already guessed for you.
   *
   * The pair is still what the draft stores. This is a reading of it, so a
   * draft written before the two groups were merged still loads.
   */
  type Claim = "card" | "cardReturn" | "own";
  const CLAIMS: Record<Claim, { direction: Direction; paymentType: PaymentType }> = {
    card: { direction: "out", paymentType: "CARD" },
    cardReturn: { direction: "return", paymentType: "CARD" },
    own: { direction: "out", paymentType: "REIMBURSEMENT" },
  };
  const claim: Claim =
    paymentType === "CARD" ? (direction === "return" ? "cardReturn" : "card") : "own";

  /**
   * Which of the three are on offer.
   *
   * The card ones only to somebody who holds one, plus an utlägg already filed
   * as a card purchase, which keeps its own answer visible even if the card has
   * since changed hands. Opened from a particular purchase there is no choice at
   * all: that money has already left the section's account, and the transaction
   * itself says which way it went.
   */
  // `existing` as well as the current answer: somebody who no longer holds the
  // card, editing an utlägg filed as a card purchase, must be able to switch
  // away and back. On the current answer alone, switching to "eget utlägg"
  // would close the door behind them.
  const cardAllowed = holdsCard || paymentType === "CARD" || existing?.paymentType === "CARD";
  const claimOptions: Claim[] = presetTxn
    ? [claim]
    : cardAllowed
      ? (["card", "cardReturn", "own"] as Claim[])
      : (["own"] as Claim[]);

  const chooseClaim = (next: Claim) =>
    setDraft((d) => ({
      ...d,
      ...CLAIMS[next],
      // A match belongs to a card purchase and to nothing else (see
      // isMatchable). Carrying one across to an eget utlägg would have the
      // section paying for the purchase twice, and the PATCH route drops it
      // anyway; dropping it here is what keeps the screen saying the same thing
      // the server will.
      matchId: CLAIMS[next].paymentType === "CARD" ? d.matchId : null,
    }));

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
    // Kept for a reload, on the same terms as what is typed: only for a new
    // claim, since an utlägg being edited is the server's and a local copy
    // outliving somebody else's change is the thing `useLocalDraft` refuses to
    // do. Not awaited; a receipt that failed to be kept is one that has to be
    // picked again after a reload, which is where this started.
    if (!existing) void keepFile(draftKey, file);
  }

  /**
   * The receipt picked before the last reload, put back.
   *
   * Once, on mount, and only over an empty hand: a file already picked in this
   * session is newer than anything stored, and the panel is showing it.
   *
   * The preview URL is made here rather than by `handleFile` so that the stored
   * file does not count as a fresh pick; everything else about it is the same.
   */
  useEffect(() => {
    if (existing) return;
    let live = true;
    void readKeptFile(draftKey).then((file) => {
      if (!live || !file) return;
      setPendingFile((held) => {
        if (held) return held;
        setPreviewUrl(URL.createObjectURL(file));
        setUploadedMime(file.type);
        setUploadedName(file.name);
        return file;
      });
    });
    return () => {
      live = false;
    };
    // Once per key. `pendingFile` is read through the setter rather than taken
    // as a dependency, so a pick landing between the read starting and
    // finishing wins without the read re-running every time one does.
  }, [draftKey, existing]);

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
    // And the browser's copy is spent: the file is somewhere it can be read
    // back from, and restoring it over a later claim would attach the wrong
    // receipt to it.
    void dropKeptFile(draftKey);
    return true;
  }

  /**
   * What the figures in the form mean, as a signed number.
   *
   * The form holds magnitudes and the toggle holds the direction; every reader
   * below this line wants the two put together, because that is what an utlägg
   * is worth and what the database stores. The one multiplication lives here so
   * no screen has to remember to do it.
   *
   * High up, and deliberately: the matching below needs it, and reading
   * `parseSEK(form.gross)` there instead is what broke returns. A magnitude and
   * a signed amount are the same number for a purchase, so the mistake was
   * invisible on the only path anybody took.
   */
  const sign = direction === "return" ? -1 : 1;
  const magnitude = parseSEK(form.gross);
  const grossSEK = sign * magnitude;

  // Which card rows could settle this, best first. The rule is in
  // lib/domain/matching.ts, where it can be tested; see `matchCandidates` for
  // why `grossSEK` and not the form's own figure.
  const candidates = useMemo(
    () => matchCandidates(bankTransactions, grossSEK, matchId),
    [bankTransactions, grossSEK, matchId],
  );

  // A match only counts while it still cancels the amount out. Editing the
  // amount afterwards silently invalidates it, and the server rejects it too.
  const matchedTxn = bankTransactions.find((t) => t.id === matchId);
  const matchDone = !!matchedTxn && cancelsOut(matchedTxn.amount, grossSEK);
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
    magnitude !== 0 &&
    dateComplete &&
    !dateInFuture &&
    !dateTooLate &&
    allocations.length > 0 &&
    allocations.every((a) => a.costCenterCode);
  // A submitted/approved expense can be edited but not re-submitted from here.
  const submittable = !existing || isSubmittable(existing.status);

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
    // The receipt half of the same copy. `writeReceipt` has usually dropped it
    // already; this covers the exits where there was nothing to upload, an
    // utlägg saved with its receipt still to come.
    void dropKeptFile(draftKey);
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
                below it depends on: what the figures mean, whether the 60-day
                deadline applies, whether a payout account is wanted, and
                whether this wizard has a Matcha step at all.

                One group, not two. The direction and the payment type were
                asked separately, at the top and the bottom of this same card,
                and they are one question with three answers. Split, the date
                three fields down was being judged against a payment type
                nobody had reached yet: a four-month-old card purchase came up
                as "too old to file" and Continue stayed dead until you scrolled
                past the fördelning to change it.

                Not asked at all where there is one answer. Somebody with no
                card can only be laying out their own money, and a lone card
                nobody chose reads as a group that is broken. */}
            {claimOptions.length > 1 && (
              <FieldGroup label={t("claim")} requirement="required">
                {/* A container query, not a viewport one, because the width
                    these three have is not the window's. The receipt panel is
                    ~520px of it and the nav rail another 64, so at 941px with
                    the panel open this column is about 320px: `sm:grid-cols-3`
                    was true and there were three 100px cards in it. `@xl` is
                    the column being wide enough for three, whatever the window
                    is doing and whether the panel is open or shut.

                    42rem, not the 36 that three cards technically fit in: at 36
                    each one is 184px wide and "Sektionskort, retur" is most of
                    that. Stacked is never broken, only taller, so the threshold
                    is where three read comfortably rather than where they last
                    fit.

                    The same trick the fördelning below already uses. */}
                <div className="@container">
                  <div className="grid gap-3 @2xl:grid-cols-3">
                    {claimOptions.map((c) => (
                      <button
                        key={c}
                        onClick={() => chooseClaim(c)}
                        className={optionCard(claim === c)}
                        aria-pressed={claim === c}
                      >
                        {/* The icon in its own colour, which is the same mark
                            the list will show this claim with afterwards.
                            Learning it here is the point: choosing is the one
                            moment they are side by side with their meanings
                            spelled out.

                            `min-w-0` on the label, so a long one wraps inside
                            the card rather than pushing the icon out of it. */}
                        <span className="flex items-start gap-2">
                          <PaymentIcon
                            type={CLAIMS[c].paymentType}
                            className="mt-0.5 size-4 shrink-0"
                          />
                          <span className="min-w-0 text-sm font-medium">
                            {t(`claimOption.${c}`)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {t(`claimHint.${c}`)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </FieldGroup>
            )}

            {/* Opened from one purchase on the card: there is no choice, and
                saying why beats showing a single card nobody picked. */}
            {presetTxn && <p className="text-xs text-muted">{t("paymentTypeFixed")}</p>}

            <Field label={t("description")} requirement="required">
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
                requirement="required"
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
              <Field label={t("amount")} requirement="required">
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

            <FieldGroup label={t("distribution")} requirement="required">
              <AllocationEditor
                costCenters={selectableCostCenters}
                grossAmount={magnitude}
                value={allocations}
                onChange={setAllocations}
              />
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
        <MatchStep
          candidates={candidates}
          matchId={matchId}
          onPick={setMatchId}
          grossSEK={grossSEK}
          onBack={() => setStep(0)}
          onSave={saveDraft}
          saveLabel={saveLabel}
          saveDisabled={!canPersist}
          saving={exit === "draft"}
          canContinue={matchDone}
          onContinue={() => setStep(2)}
        />
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
              <DetailRow label={t("paymentType")} value={<PaymentTag type={paymentType} />} />
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
