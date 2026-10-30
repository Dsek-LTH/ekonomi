"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useReturnTo } from "@/components/shell/route-history";
import { useTranslations } from "next-intl";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { usePhone } from "@/lib/ui/media";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { AmountInput } from "@/components/ui/amount-input";
import { PageShell } from "@/components/page-shell";
import { wizardChrome } from "./wizard-chrome";
import { Field, FieldGroup, Input, DateInput } from "@/components/ui/field";
import { SubmitBlockerNote } from "@/components/submit-blocker-note";
import {
  REIMBURSEMENT_DEADLINE_DAYS,
  isLateReimbursement,
  isSubmittable,
  submitBlocker,
} from "@/lib/domain/status";
import { isCompleteDate, isFutureDate } from "@/lib/domain/date";
import { useFiscalYear } from "@/components/shell/fiscal-year-context";
import { fiscalYearLabel, outsideFiscalYear } from "@/lib/ui/fiscal-year";
import { Amount } from "@/components/ui/amount";
// Still needed for the amounts that sit inside a translated sentence, where a
// React node cannot go.
import { formatSEK } from "@/lib/ui/format";
import { parseSEK, sekToOre } from "@/lib/domain/money";
import type { CreateExpense, PatchExpense } from "@/lib/api/schemas/expense";
import { cancelsOut, isMatchable, matchCandidates } from "@/lib/domain/matching";
import type {
  BankTransaction,
  CostCenter,
  Expense,
  PaymentType,
  ReceiptSummary,
} from "@/lib/domain/types";
import { PaymentIcon, PaymentTag } from "@/components/ui/payment-tag";
import { MatchSection } from "./match-step";
import { MatchHelp } from "@/components/transaction-picker";
import { likelyDuplicates, type ExpenseFingerprint } from "@/lib/domain/duplicates";
import { Notice } from "@/components/ui/notice";
import Link from "next/link";
import { FormSection, optionCard } from "./step-chrome";
import { ActionBar } from "@/components/action-bar";
import { dropKeptFile, dropKeptFiles, keepFile, readKeptFiles } from "@/lib/ui/kept-file";
import { uid } from "@/lib/ui/utils";
import { underlagCaption } from "@/lib/expense/document-url";
import { useFormat } from "@/lib/ui/use-format";
import { useSelectOnce } from "@/lib/ui/use-select-once";
import { AllocationEditor, makeRow } from "@/components/allocation-editor";
import { useLocalDraft } from "@/lib/ui/use-local-draft";
import type { AllocationRow } from "@/components/allocation-editor";

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
 *
 * The "utlagg" prefix is the project's old name, kept on purpose. Renaming it
 * would drop every draft already saved in a browser.
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
  ownExpenses,
  existing,
}: {
  costCenters: CostCenter[];
  bankTransactions: BankTransaction[];
  holdsCard: boolean;
  payoutClearing: string;
  payoutAccount: string;
  /** The submitter's recent utlägg, for the duplicate warning. */
  ownExpenses: ExpenseFingerprint[];
  existing?: Expense;
}) {
  const returnTo = useReturnTo();
  const t = useTranslations("expenses.wizard");
  const phone = usePhone();
  const tReceipt = useTranslations("receipt");
  const tCommon = useTranslations("common");
  const fiscalYear = useFiscalYear();
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
  // Opened from one purchase there is no choice to make, but all three still
  // show: seeing which of them this is beats being told only that it's fixed.
  // `presetTxn` always holds a card (it came from that card's own bank feed),
  // so this never disagrees with `cardAllowed` about there being three to show.
  const claimOptions: Claim[] = presetTxn || cardAllowed
    ? (["card", "cardReturn", "own"] as Claim[])
    : (["own"] as Claim[]);
  const locked = Boolean(presetTxn);

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
  // The documents already in the archive, oldest first. Only an utlägg being
  // edited starts with any. Removing one calls the server right away (see
  // `removeUploadedReceipt`): it is already stored, so "remove" is a real act
  // rather than a change waiting to be saved, the same as pulling a match off.
  const [uploadedReceipts, setUploadedReceipts] = useState<ReceiptSummary[]>(
    existing?.receipts ?? [],
  );

  // Documents as picked, before any is anywhere but this browser. Dropping a
  // file used to create the utlägg and upload on the spot, which meant walking
  // away from a half-filled wizard left a bare row and a stored file behind,
  // and every abandoned attempt was something a bookkeeper later had to look at
  // and dismiss. Now each one waits here and goes up with the save, so leaving
  // the page leaves nothing. Several rather than one: some receipts only
  // substantiate a purchase alongside a second, complementary document, and a
  // single pick or drop can bring them all (see `multiple` on the panel).
  const [pendingFiles, setPendingFiles] = useState<
    { id: string; file: File; previewUrl: string }[]
  >([]);
  // The documents in the order the reader put them, by key: a stored one's
  // receipt id, a waiting one's local id. Only what has been moved is in here
  // in any meaningful sense; anything missing goes after it, in the order it
  // arrived (see `documents` below), so adding a file needs no bookkeeping.
  const [order, setOrder] = useState<string[]>([]);

  // Kept current without being a dependency, so the unmount cleanup below
  // sees every preview URL ever created under this draft rather than only
  // the ones present when the effect last ran.
  const pendingFilesRef = useRef(pendingFiles);
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  });
  // Every preview URL still outstanding when the page goes, or this draft is
  // abandoned for another; each is otherwise revoked the moment it stops
  // being shown (`removePendingFile`, `writeReceipts`).
  useEffect(() => {
    return () => {
      for (const p of pendingFilesRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, [draftKey]);

  function addFile(file: File) {
    const id = uid();
    const previewUrl = URL.createObjectURL(file);
    setPendingFiles((files) => [...files, { id, file, previewUrl }]);
    // Kept for a reload, on the same terms as what is typed: only for a new
    // claim, since an utlägg being edited is the server's and a local copy
    // outliving somebody else's change is the thing `useLocalDraft` refuses to
    // do. Not awaited; a file that failed to be kept is one that has to be
    // picked again after a reload, which is where this started.
    if (!existing) void keepFile(draftKey, id, file);
  }

  function removePendingFile(id: string) {
    setPendingFiles((files) => {
      const dropped = files.find((f) => f.id === id);
      if (dropped) URL.revokeObjectURL(dropped.previewUrl);
      return files.filter((f) => f.id !== id);
    });
    if (!existing) void dropKeptFile(draftKey, id);
  }

  // Already in the archive: removing it is immediate, not deferred to the
  // next save, the same as `removeMatch` elsewhere on this page.
  async function removeUploadedReceipt(id: string) {
    const ok = await mutate(`/api/receipts/${id}`, {
      key: "save",
      method: "DELETE",
      error: t("removeDocumentFailed"),
      refresh: false,
    });
    if (ok === null) return;
    setUploadedReceipts((rs) => rs.filter((r) => r.id !== id));
  }

  /**
   * The files picked before the last reload, put back.
   *
   * Once, on mount, and merged rather than replacing whatever a fast reader
   * has already picked again in the meantime: a file already picked in this
   * session is newer than anything stored, and the panel is already showing
   * it.
   */
  useEffect(() => {
    if (existing) return;
    let live = true;
    void readKeptFiles(draftKey).then((kept) => {
      if (!live || kept.length === 0) return;
      setPendingFiles((files) => {
        const have = new Set(files.map((f) => f.id));
        const restored = kept
          .filter((k) => !have.has(k.id))
          .map((k) => ({ id: k.id, file: k.file, previewUrl: URL.createObjectURL(k.file) }));
        return restored.length > 0 ? [...files, ...restored] : files;
      });
    });
    return () => {
      live = false;
    };
  }, [draftKey, existing]);

  // Whether there is at least one document, which is the only form of the
  // question this page ever asks. Every gate here (continue, save, submit)
  // wants "has the reader produced one", not "is one in the archive". Those
  // were the same thing while the upload happened on drop; they aren't now.
  const hasReceipt = uploadedReceipts.length > 0 || pendingFiles.length > 0;

  // Every document, stored and waiting, in the reader's order: the ones they
  // have placed by `order`, the rest after them, stored first and then
  // waiting, each in the order it arrived. A reader who has just added a
  // second document expects to find it behind the first, not in front of it.
  const docs = useMemo(() => {
    const all = [
      ...uploadedReceipts.map((r) => ({ kind: "uploaded" as const, key: r.id, receipt: r })),
      ...pendingFiles.map((p) => ({ kind: "pending" as const, key: p.id, pending: p })),
    ];
    const rank = new Map(order.map((k, i) => [k, i]));
    return all
      .map((d, i) => ({ d, r: rank.get(d.key) ?? order.length + i }))
      .sort((a, b) => a.r - b.r)
      .map(({ d }) => d);
  }, [uploadedReceipts, pendingFiles, order]);


  // Put every waiting document in the archive. Part of saving now, so it can
  // fail the save: an utlägg whose document didn't make it is not saved but
  // half saved, and the next attempt tries the upload again against the row
  // that by then already exists. Stops at the first failure, the same as a
  // single-file upload used to: the ones before it are already stored (and
  // dropped from `pendingFiles`), and a retry only has to send the rest.
  async function writeReceipts(id: string): Promise<boolean> {
    // In the order shown, so the new ones are appended in that order, and the
    // receipt id each waiting file became, for the order saved after them.
    const storedAs = new Map<string, string>();
    for (const doc of docs) {
      if (doc.kind !== "pending") continue;
      const pending = doc.pending;
      const fd = new FormData();
      fd.append("file", pending.file);
      const receipt = await mutate<ReceiptSummary>(`/api/expenses/${id}/receipts`, {
        key: "save",
        body: fd,
        error: t("uploadFailed"),
        refresh: false,
      });
      if (!receipt) return false;
      storedAs.set(pending.id, receipt.id);
      setUploadedReceipts((rs) => [...rs, receipt]);
      setOrder((o) => o.map((k) => (k === pending.id ? receipt.id : k)));
      URL.revokeObjectURL(pending.previewUrl);
      setPendingFiles((files) => files.filter((f) => f.id !== pending.id));
      // And the browser's copy is spent: the file is somewhere it can be read
      // back from, and restoring it over a later claim would attach the wrong
      // document to it.
      void dropKeptFile(draftKey, pending.id);
    }
    // Then the order, for the whole set. A new file lands last on the server
    // whatever the reader did with it here, and a stored one moved on this
    // form has only moved here until this is sent.
    if (docs.length > 1) {
      const ids = docs.map((d) => (d.kind === "pending" ? storedAs.get(d.key)! : d.key));
      const ok = await mutate(`/api/expenses/${id}/receipts/order`, {
        key: "save",
        method: "PUT",
        body: { ids },
        error: t("reorderFailed"),
        refresh: false,
      });
      if (ok === null) return false;
    }
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
    () => matchCandidates(bankTransactions, grossSEK, matchId, form.purchaseDate),
    [bankTransactions, grossSEK, matchId, form.purchaseDate],
  );

  // A match only counts while it still cancels the amount out. Editing the
  // amount afterwards silently invalidates it, and the server rejects it too.
  const matchedTxn = bankTransactions.find((t) => t.id === matchId);
  const matchDone = !!matchedTxn && cancelsOut(matchedTxn.amount, grossSEK);

  // Where exactly one card purchase fits, it is the answer, so it is picked
  // for you: the section folds to that one line, with a way to change it. Also
  // when the amount changes under a match that no longer fits and another now
  // does. Never over a match that still fits, which someone may have chosen.
  const onlyFit = useMemo(() => {
    const fits = candidates.filter((c) => c.selectable);
    return fits.length === 1 ? fits[0].txn.id : null;
  }, [candidates]);
  useEffect(() => {
    if (paymentType !== "CARD" || matchDone || !onlyFit) return;
    setMatchId(onlyFit);
    // setMatchId is rebuilt every render and changes nothing a rerun needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType, matchDone, onlyFit]);

  // The fix for an amount typed wrong: take the bank's, and pick the row.
  function takeBankAmount(txn: BankTransaction) {
    const gross = Math.abs(txn.amount).toFixed(2).replace(".", ",");
    setDraft((d) => ({
      ...d,
      form: { ...d.form, gross },
      matchId: txn.id,
      // A single row is the whole amount, so it follows it, as typing does.
      allocations: d.allocations.length === 1 ? [{ ...d.allocations[0], amount: gross }] : d.allocations,
    }));
  }
  // The date field is a mask, so it can be left half-typed ("2026", "2026-07").
  // Empty is a draft in progress; a partial date is an error to point at.
  const dateComplete = isCompleteDate(form.purchaseDate);
  const dateIncomplete = form.purchaseDate !== "" && !dateComplete;
  // Nothing has been bought tomorrow. Almost always a mistyped year, so it's
  // pointed at here rather than left for the server to refuse on save.
  const dateInFuture = isFutureDate(form.purchaseDate);
  // Outside the year picked in the header, where the utlägg would be missing
  // from the list it was made from. Not for a date the utlägg already had,
  // which the route lets stand as well.
  const dateOutsideYear =
    form.purchaseDate !== (existing?.purchaseDate ?? "") && outsideFiscalYear(fiscalYear, form.purchaseDate);
  // Past the 60-day deadline for an eget utlägg. Depends on the payment type,
  // which is picked further down this same step, so switching to "Eget utlägg"
  // lights this up on an old receipt then and there.
  //
  // A warning, not an error, and it stops nothing on this form. It used to stop
  // everything: the wizard would neither continue nor save, so a late receipt
  // could not be written down at all. That was right while a late claim could
  // never be paid, and wrong the moment a dispens existed, because a dispens is
  // granted against a claim, and there was no way to bring one into being for
  // the skattmästare to look at.
  //
  // Sending it is still refused, by `blocker` below and by the transition route
  // behind it. What the submitter can now do is finish the utlägg and leave it
  // as a draft, which is the thing a dispens is asked for.
  const dateTooLate = isLateReimbursement(form.purchaseDate, paymentType);

  // The same receipt handed in twice: the same amount, near the same day, among
  // the submitter's own. Warned about, never refused; see lib/domain/duplicates.
  // Once the date is whole, so a half-typed one does not flash a match.
  const duplicates = useMemo(
    () =>
      dateComplete
        ? likelyDuplicates(ownExpenses, {
            grossAmount: grossSEK,
            purchaseDate: form.purchaseDate,
            excludeId: draftId,
          })
        : [],
    [ownExpenses, grossSEK, form.purchaseDate, draftId, dateComplete],
  );
  // What to say about it, in the order the reader should try things: the rule,
  // then the cheap fix, then the expensive one.
  //
  // The cheap fix is only offered to somebody it is open to. "Var det
  // sektionskortet du använde?" is a question with no answer for a member who
  // holds no card, and pointing them at a picker that does not offer CARD is
  // worse than saying nothing: it reads as though they have missed something.
  // `cardAllowed` is the same condition the picker itself is built from, so the
  // sentence and the options it describes cannot come apart.
  const tooLateHint = [
    t("dateTooLate", { days: REIMBURSEMENT_DEADLINE_DAYS }),
    cardAllowed ? t("dateTooLateCard") : null,
    t("dateTooLateWaiver"),
  ]
    .filter(Boolean)
    .join(" ");
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
    !dateOutsideYear &&
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
    // False, and it cannot be anything else here: a dispens is granted against
    // an utlägg that already exists, by somebody who is not the person filling
    // this in. Somebody whose claim is too old sees the deadline here and asks
    // the skattmästare, and the dispens shows up on the detail page.
    deadlineWaived: false,
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
    if (!(await writeReceipts(id))) return null;
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
    // The receipt half of the same copy. `writeReceipts` has usually dropped
    // every file it uploaded already; this covers the exits where there was
    // nothing to upload, an utlägg saved with its documents still to come.
    void dropKeptFiles(draftKey);
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

  const chrome = wizardChrome({ existing, t });

  // Every document the panel has to show, in the reader's order (see `docs`).
  // Captioned the same way a saved utlägg's
  // are (see underlagCaption): a submitter should not learn a new word for
  // the same thing between filling this in and reading it back on the
  // detail page, and the merged PDF Fortnox gets uses the same numbering.
  const receiptFiles = docs.map((d) =>
    d.kind === "uploaded"
      ? { src: `/api/receipts/${d.receipt.id}`, mimeType: d.receipt.mimeType, filename: d.receipt.filename }
      : { src: d.pending.previewUrl, mimeType: d.pending.file.type, filename: d.pending.file.name },
  );
  const documents = receiptFiles.map((d, i) => ({
    ...d,
    label: underlagCaption(tReceipt("underlagLabel"), i, receiptFiles.length, d.filename),
  }));

  // What still has to be filled in before this can be sent, by name, for the
  // action bar. In the order the page asks for them.
  const missing = [
    !hasReceipt && t("missing.receipt"),
    !form.title.trim() && t("missing.title"),
    !dateComplete && t("missing.date"),
    magnitude === 0 && t("missing.amount"),
    (allocations.length === 0 || allocations.some((a) => !a.costCenterCode)) &&
      t("missing.costCenter"),
    paymentType === "CARD" && !matchDone && t("missing.match"),
  ].filter((m): m is string => Boolean(m));

  // Whose attest it goes to, for the action bar: the result units its cost
  // centres belong to.
  const resultUnits = [
    ...new Set(
      allocations
        .map((a) => costCenters.find((c) => c.code === a.costCenterCode)?.resultUnit)
        .filter(Boolean),
    ),
  ].join(", ");

  function removeDocument(key: string) {
    const d = docs.find((x) => x.key === key);
    if (d?.kind === "uploaded") void removeUploadedReceipt(key);
    else removePendingFile(key);
  }

  return (
    <PageShell
      title={chrome.title}
      back={chrome.back}
      width="content"
    >
      {/* The panel takes documents as well as showing them: with none
          uploaded yet it stands open beside the form as the dropzone, which
          is why this wizard has no upload step of its own. Once one is
          showing, the floating button adds another rather than replacing it
          (`addLabel`): some receipts only substantiate a purchase alongside a
          second, complementary document, and the wording says so.

          `multiple`, so those documents can be picked or dropped together.
          The panel hands them to `addFile` one at a time, in order, so each
          is kept, shown and uploaded exactly as a single pick is. */}
      <ReceiptPanelSource
        documents={documents}
        onFile={addFile}
        uploading={saving}
        multiple
        // The thumbnails along the panel's foot: the one place the documents
        // are put in order and taken off. See components/receipt/document-strip.
        arrange={{
          keys: docs.map((d) => d.key),
          onReorder: setOrder,
          onRemove: removeDocument,
          disabled: saving,
        }}
        uploadCopy={{
          addLabel: tReceipt("addDocument"),
          lead: tReceipt("dropzoneMany"),
          leadShort: tReceipt("pickReceiptLeadMany"),
          action: tReceipt("pickReceipts"),
        }}
      />

      <div className="space-y-6">
        {/* One card, no headings: the fields say what they are, and a
            heading over every two of them was height spent saying it again. */}
        <FormSection>
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
            <FieldGroup label={t("claim")} requirement={locked ? undefined : "required"}>
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
                  {claimOptions.map((c) => {
                    // The icon in its own colour, which is the same mark the
                    // list will show this claim with afterwards. Learning it
                    // here is the point: choosing (or, locked, simply seeing)
                    // is the one moment they are side by side with their
                    // meanings spelled out.
                    //
                    // `min-w-0` on the label, so a long one wraps inside the
                    // card rather than pushing the icon out of it.
                    const content = (
                      <>
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
                      </>
                    );
                    // Opened from one purchase there is nothing to press:
                    // the money already left that way, and the other two
                    // cards are shown, muted, only so the reader can see
                    // what this one wasn't.
                    return locked ? (
                      <div key={c} className={optionCard(claim === c, true)}>
                        {content}
                      </div>
                    ) : (
                      <button
                        key={c}
                        onClick={() => chooseClaim(c)}
                        className={optionCard(claim === c)}
                        aria-pressed={claim === c}
                      >
                        {content}
                      </button>
                    );
                  })}
                </div>
              </div>
              {locked && (
                <p className="mt-2 text-xs text-muted">{t("paymentTypeFixed")}</p>
              )}
            </FieldGroup>
          )}

          <Field label={t("description")} requirement="required">
            <Input
              // Not on a phone. There it opens no keyboard (iOS will not
              // raise one without a tap) and only puts a caret in a field the
              // receipt panel is covering, while the page reads as somebody
              // typing and puts the receipt button away.
              autoFocus={!phone}
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
                    : dateOutsideYear
                      ? tCommon("dateOutsideFiscalYear", { year: fiscalYearLabel(fiscalYear!) })
                      : undefined
              }
              // A hint rather than an error: the date is a real day and the
              // form accepts it. What it cannot do is be sent without a
              // dispens, and marking the field invalid would be saying the
              // submitter typed something wrong when they typed the truth.
              hint={dateTooLate ? tooLateHint : undefined}
            >
              <DateInput
                min={fiscalYear?.fromDate}
                max={fiscalYear?.toDate}
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
            </Field>
          </div>

          {duplicates.length > 0 && (
            <Notice>
              <p>{t("duplicateLead", { count: duplicates.length })}</p>
              <ul className="mt-1 space-y-0.5">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/expenses/${d.id}`}
                      target="_blank"
                      className="font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current"
                    >
                      {d.reference ? `${d.reference} - ` : ""}
                      {d.title || t("duplicateUntitled")}
                    </Link>
                    <span className="text-muted">
                      {" "}
                      {t("duplicateDetail", {
                        date: date(d.purchaseDate),
                        amount: formatSEK(d.grossAmount),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-muted">{t("duplicateHint")}</p>
            </Notice>
          )}

          <FieldGroup label={t("distribution")} requirement="required">
            <AllocationEditor
              costCenters={selectableCostCenters}
              grossAmount={magnitude}
              value={allocations}
              onChange={setAllocations}
            />
          </FieldGroup>
        </FormSection>

        {/* A card purchase is settled by the bank row it was, so which one is
            the last thing asked. It was a step of its own; it is a section of
            the same page now, and only there for a card. */}
        {paymentType === "CARD" && (
          <FormSection title={t("matchTitle")} hint={<MatchHelp />}>
            <MatchSection
              candidates={candidates}
              matchId={matchId}
              onPick={setMatchId}
              grossSEK={grossSEK}
              onUseAmount={takeBankAmount}
            />
          </FormSection>
        )}
      </div>

      <ActionBar
        summary={
          <>
            <span className="font-medium">
              <Amount value={grossSEK} signed />
            </span>
            <PaymentTag type={paymentType} />
            {resultUnits && (
              <span className="text-xs text-muted">{t("goesTo", { resultUnits })}</span>
            )}
          </>
        }
        missing={missing}
        missingLabel={t("missingLabel")}
        note={
          submittable && blocker ? (
            <SubmitBlockerNote
              blocker={blocker}
              paymentType={paymentType}
              className="text-xs text-warning"
            />
          ) : undefined
        }
        onSave={saveDraft}
        saveLabel={saveLabel}
        saveDisabled={!canPersist}
        saving={exit === "draft"}
        submit={
          submittable
            ? {
                label:
                  existing?.status === "CHANGES_REQUESTED" ? t("resubmit") : t("submit"),
                onClick: submitExpense,
                disabled: !canPersist || Boolean(blocker),
                loading: exit === "submit",
              }
            : undefined
        }
      />
    </PageShell>
  );
}
