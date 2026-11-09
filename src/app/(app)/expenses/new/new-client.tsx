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
import { MatchHelp, TransactionPicker } from "@/components/transaction-picker";
import { likelyDuplicates, type ExpenseFingerprint } from "@/lib/domain/duplicates";
import { Notice } from "@/components/ui/notice";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { ActionBar } from "@/components/action-bar";
import { dropKeptFile, dropKeptFiles, keepFile, readKeptFiles } from "@/lib/ui/kept-file";
import { displayableFile } from "@/lib/ui/heic";
import { cn, uid } from "@/lib/ui/utils";
import { underlagCaption } from "@/lib/expense/document-url";
import { useFormat } from "@/lib/ui/use-format";
import { useSelectOnce } from "@/lib/ui/use-select-once";
import { AllocationEditor, makeRow } from "@/components/allocation-editor";
import { useLocalDraft } from "@/lib/ui/use-local-draft";
import type { AllocationRow } from "@/components/allocation-editor";

/** Which way the money goes. A question of its own because a phone's number pad has no minus key (components/ui/amount-input.tsx).
 * Every figure in the form is a magnitude. */
type Direction = "out" | "return";

/** A choice card for how the purchase was paid. Locked cards are shown muted. */
const optionCard = (selected: boolean, locked = false) =>
  cn(
    "w-full rounded-control border px-4 py-3 text-left transition-colors",
    selected
      ? "border-accent bg-accent-soft"
      : locked
        ? "border-border opacity-50"
        : "border-border hover:bg-hover",
  );

/** What the wizard is holding: every field it fills in, and nothing derived. */
type WizardDraft = {
  form: { title: string; purchaseDate: string; gross: string };
  direction: Direction;
  allocations: AllocationRow[];
  paymentType: PaymentType;
  matchId: string | null;
};

/** Where a half-filled new utlägg waits. Versioned, so an outdated draft is left rather than loaded.
 * The "utlagg" prefix is the project's old name, kept so saved drafts survive. */
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
  /** Everything the wizard holds that the server has not been told about: one storable object (lib/ui/use-local-draft.ts). */
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
        // Unpicked on a new utlägg: defaulting to the first would let a wrong one through. submitBlocker requires a pick.
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
        // A card purchase is money leaving, a credit on the card is money coming back. The transaction says which.
        direction: presetTxn && presetTxn.amount > 0 ? "return" : "out",
        allocations: [makeRow("", presetTxn ? String(Math.abs(presetTxn.amount)) : "")],
        paymentType: holdsCard ? "CARD" : "REIMBURSEMENT",
        matchId: presetTxn ? presetTxn.id : null,
      };

  /** Kept in this browser until the utlägg exists on the server. Only for a new one: a local copy of an edited utlägg could put a stale figure back.
   * A card purchase started from a bank transaction gets its own key. The picked receipt is kept too, in IndexedDB (lib/ui/kept-file.ts), since a Blob is not a string. */
  const draftKey = presetTxn ? `${DRAFT_KEY}:${presetTxn.id}` : DRAFT_KEY;
  const [draft, setDraft, , forgetDraft] = useLocalDraft<WizardDraft>(
    draftKey,
    startingDraft,
    !existing,
  );
  const { form, direction, allocations, paymentType, matchId } = draft;

  /** What is being claimed, asked once: direction and payment type are one question with three answers (a return is a refund on the card it was paid from).
   * It comes first because the payment type decides the 60-day deadline, the payout account and the Matcha step.
   * The draft still stores the pair, so older drafts load. */
  type Claim = "card" | "cardReturn" | "own";
  const CLAIMS: Record<Claim, { direction: Direction; paymentType: PaymentType }> = {
    card: { direction: "out", paymentType: "CARD" },
    cardReturn: { direction: "return", paymentType: "CARD" },
    own: { direction: "out", paymentType: "REIMBURSEMENT" },
  };
  const claim: Claim =
    paymentType === "CARD" ? (direction === "return" ? "cardReturn" : "card") : "own";

  /** Which of the three are on offer. Card ones only to somebody who holds a card, plus an utlägg already filed as one. Opened from a purchase there is no choice. */
  // `existing` as well as the current answer, so someone who lost the card can switch away and back.
  const cardAllowed = holdsCard || paymentType === "CARD" || existing?.paymentType === "CARD";
  // Opened from one purchase all three still show. `presetTxn` always holds a card, so this agrees with `cardAllowed`.
  const claimOptions: Claim[] =
    presetTxn || cardAllowed ? (["card", "cardReturn", "own"] as Claim[]) : (["own"] as Claim[]);
  const locked = Boolean(presetTxn);

  const chooseClaim = (next: Claim) =>
    setDraft((d) => ({
      ...d,
      ...CLAIMS[next],
      // A match belongs to a card purchase only (isMatchable): carrying it to an eget utlägg would pay twice. The PATCH route drops it too.
      matchId: CLAIMS[next].paymentType === "CARD" ? d.matchId : null,
    }));

  const patchDraft = <K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setForm = (value: WizardDraft["form"]) => patchDraft("form", value);
  const setAllocations = (value: AllocationRow[]) => patchDraft("allocations", value);
  const setMatchId = (value: string | null) => patchDraft("matchId", value);

  // One busy scope for saving, submitting and the receipt upload inside them.
  const { pending, mutate } = useMutation();
  const saving = pending === "save";
  const saveLabel = editing ? t("save") : t("saveDraft");
  // Which of the two exits is running (`saving` can't tell them apart). Cleared only on failure: on success the page is leaving.
  const [exit, setExit] = useState<"draft" | "submit" | null>(null);

  // The utlägg's own id once there is a row, null until saved (see `persist`). The id, not the reference: there is none until submit.
  const [draftId, setDraftId] = useState<string | null>(existing?.id ?? null);
  // The documents already in the archive, oldest first (edit only). Removing one calls the server at once (`removeUploadedReceipt`).
  const [uploadedReceipts, setUploadedReceipts] = useState<ReceiptSummary[]>(
    existing?.receipts ?? [],
  );

  // Documents as picked, held in this browser until the save so an abandoned wizard leaves no row or file behind.
  // Several, since a receipt may need a complementary document (`multiple` on the panel).
  const [pendingFiles, setPendingFiles] = useState<
    { id: string; file: File; previewUrl: string }[]
  >([]);
  // The documents in the reader's order, by key (stored receipt id or waiting local id). Anything missing goes after, in arrival order.
  const [order, setOrder] = useState<string[]>([]);

  // Kept current without being a dependency, so the unmount cleanup sees every preview URL created under this draft.
  const pendingFilesRef = useRef(pendingFiles);
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  });
  // Every preview URL still outstanding when the page goes or the draft is abandoned.
  useEffect(() => {
    return () => {
      for (const p of pendingFilesRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, [draftKey]);

  // A HEIC is made a JPEG before it is shown (lib/ui/heic), so files go through one at a time to keep their order.
  const [converting, setConverting] = useState(0);
  const addQueue = useRef(Promise.resolve());

  function addFile(picked: File) {
    setConverting((n) => n + 1);
    addQueue.current = addQueue.current.then(async () => {
      const file = await displayableFile(picked);
      setConverting((n) => n - 1);
      addPendingFile(file);
    });
  }

  function addPendingFile(file: File) {
    const id = uid();
    const previewUrl = URL.createObjectURL(file);
    setPendingFiles((files) => [...files, { id, file, previewUrl }]);
    // Kept for a reload, only for a new claim (see `useLocalDraft`). Not awaited: a file that failed to be kept is picked again after a reload.
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

  // Already in the archive: removing is immediate, as `removeMatch`.
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

  /** The files picked before the last reload, put back once on mount and merged with anything already picked this session. */
  useEffect(() => {
    if (existing) return;
    let live = true;
    void readKeptFiles(draftKey).then((kept) => {
      if (!live || kept.length === 0) return;
      setPendingFiles((files) => {
        const have = new Set(files.map((f) => f.id));
        const restored = kept
          .filter((k) => !have.has(k.id))
          .map((k) => ({
            id: k.id,
            file: k.file,
            previewUrl: URL.createObjectURL(k.file),
          }));
        return restored.length > 0 ? [...files, ...restored] : files;
      });
    });
    return () => {
      live = false;
    };
  }, [draftKey, existing]);

  // Whether there is at least one document, waiting or stored: every gate here asks that.
  const hasReceipt = uploadedReceipts.length > 0 || pendingFiles.length > 0;

  // Every document in the reader's order: placed by `order`, the rest after, stored first then waiting.
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

  // Put every waiting document in the archive, as part of saving. Stops at the first failure, a retry sends the rest.
  async function writeReceipts(id: string): Promise<boolean> {
    // In the order shown, collecting the receipt id each waiting file became.
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
      // The browser's copy is spent: restoring it over a later claim would attach the wrong document.
      void dropKeptFile(draftKey, pending.id);
    }
    // Then the order for the whole set: a new file lands last on the server whatever the reader did here.
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

  /** The figures as a signed number (the form holds magnitudes, the toggle the direction). The one multiplication lives here;
   * the matching below needs it signed (`parseSEK(form.gross)` broke returns). */
  const sign = direction === "return" ? -1 : 1;
  const magnitude = parseSEK(form.gross);
  const grossSEK = sign * magnitude;

  // Which card rows could settle this, best first (lib/domain/matching.ts; see `matchCandidates` for `grossSEK`).
  const candidates = useMemo(
    () => matchCandidates(bankTransactions, grossSEK, matchId, form.purchaseDate),
    [bankTransactions, grossSEK, matchId, form.purchaseDate],
  );

  // A match only counts while it still cancels the amount; the server rejects a stale one too.
  const matchedTxn = bankTransactions.find((t) => t.id === matchId);
  const matchDone = !!matchedTxn && cancelsOut(matchedTxn.amount, grossSEK);

  // Exactly one fitting card purchase is picked for you, also when the amount changes under a match that no longer fits. Never over one that still fits.
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
      allocations:
        d.allocations.length === 1 ? [{ ...d.allocations[0], amount: gross }] : d.allocations,
    }));
  }
  // The date field is a mask: empty is a draft in progress, a partial date is an error.
  const dateComplete = isCompleteDate(form.purchaseDate);
  const dateIncomplete = form.purchaseDate !== "" && !dateComplete;
  // A future day is almost always a mistyped year.
  const dateInFuture = isFutureDate(form.purchaseDate);
  // Outside the year picked in the header, unless the utlägg already had that date.
  const dateOutsideYear =
    form.purchaseDate !== (existing?.purchaseDate ?? "") &&
    outsideFiscalYear(fiscalYear, form.purchaseDate);
  // Past the 60-day deadline for an eget utlägg. Depends on the payment type, picked further down.
  // A warning that stops nothing here: a dispens is granted against an existing claim, so a late one must be saveable.
  // Sending is still refused (`blocker`, transition route).
  const dateTooLate = isLateReimbursement(form.purchaseDate, paymentType);

  // The same receipt handed in twice (lib/domain/duplicates): warned about, never refused. Only once the date is whole.
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
  // The hint in the order to try things: the rule, the cheap fix, the expensive one.
  // The cheap fix is offered only to someone who can use it (`cardAllowed`, as the picker).
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

  // Saving a draft is allowed with fields empty, but not a partial date (stored as 1 January) or a future one,
  // and not before a receipt (a file waiting in the browser counts).
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
    matchedTransactionId: matchDone ? (matchId ?? undefined) : undefined,
    submitterHasPayout: Boolean(payoutClearing && payoutAccount),
    // False here: a dispens is granted against an existing utlägg, by somebody else (the skattmästare).
    deadlineWaived: false,
    allocations: signedAllocations.map((a) => ({
      amount: a.value,
      costCenterCode: a.costCenterCode,
    })),
  });

  // Everything this wizard writes, in order: the utlägg, its receipt, the reviewed fields, then the bank match for a card purchase.
  // Returns the id because state set in a handler isn't readable from the rest of that handler.
  async function persist(): Promise<string | null> {
    let id = draftId;
    if (!id) {
      // Typed against `CreateExpense`, the schema the route validates, so a rename stops compiling.
      const create: CreateExpense = {
        paymentType,
        title: "",
        // Only with the card purchase it belongs to (the route refuses otherwise, isMatchable).
        matchedTransactionId: isMatchable(paymentType) ? (presetTxn?.id ?? null) : null,
      };
      const created = await mutate<{ id: string }>("/api/expenses", {
        key: "save",
        body: create,
        error: t("createFailed"),
        refresh: false,
      });
      if (!created) return null;
      id = created.id;
      setDraftId(id);
    }
    if (!(await writeReceipts(id))) return null;
    // Öre, both gross and rows (`PatchExpense`).
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
    // The utlägg exists on the server, so the browser copy is spent. `forget` rather than `clear`, so the form is not blanked before the page changes.
    forgetDraft();
    // The receipt half of the same copy, for exits with nothing to upload.
    void dropKeptFiles(draftKey);
    // Replaces the wizard's history entry so Back does not lead into a spent form (useReturnTo).
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

  const title = !existing
    ? t("newTitle")
    : existing.reference
      ? t("editTitle", { id: existing.reference })
      : t("editTitleDraft");
  const back = existing ? `/expenses/${existing.id}` : "/expenses";

  // Every document the panel shows, in the reader's order, captioned as a saved utlägg's (underlagCaption).
  const receiptFiles = docs.map((d) =>
    d.kind === "uploaded"
      ? {
          src: `/api/receipts/${d.receipt.id}`,
          mimeType: d.receipt.mimeType,
          filename: d.receipt.filename,
        }
      : {
          src: d.pending.previewUrl,
          mimeType: d.pending.file.type,
          filename: d.pending.file.name,
        },
  );
  const documents = receiptFiles.map((d, i) => ({
    ...d,
    label: underlagCaption(tReceipt("underlagLabel"), i, receiptFiles.length, d.filename),
  }));

  // What still has to be filled in before this can be sent, by name, in the order the page asks.
  const missing = [
    !hasReceipt && t("missing.receipt"),
    !form.title.trim() && t("missing.title"),
    !dateComplete && t("missing.date"),
    magnitude === 0 && t("missing.amount"),
    (allocations.length === 0 || allocations.some((a) => !a.costCenterCode)) &&
      t("missing.costCenter"),
    paymentType === "CARD" && !matchDone && t("missing.match"),
  ].filter((m): m is string => Boolean(m));

  // Whose attest it goes to: the result units its cost centres belong to.
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
    <PageShell title={title} back={back} width="content">
      <ReceiptPanelSource
        documents={documents}
        onFile={addFile}
        uploading={saving || converting > 0}
        multiple
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
        <Card>
          <CardBody className="space-y-3">
            {claimOptions.length > 1 && (
              <FieldGroup label={t("claim")} requirement={locked ? undefined : "required"}>
                {/* Container query, not viewport: the receipt panel and nav rail eat the width. `@xl` is where three cards read comfortably. */}
                <div className="@container">
                  <div className="grid gap-3 @2xl:grid-cols-3">
                    {claimOptions.map((c) => {
                      // The icon in its own colour, the same mark the list shows afterwards. `min-w-0` on the label so a long one wraps inside the card.
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
                      // Opened from one purchase there is nothing to press: the other cards are shown muted only so the reader sees what this one wasn't.
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
                {locked && <p className="mt-2 text-xs text-muted">{t("paymentTypeFixed")}</p>}
              </FieldGroup>
            )}

            <Field label={t("description")} requirement="required">
              <Input
                // Not on a phone: iOS raises no keyboard without a tap, and a caret would sit in a field the receipt panel covers.
                autoFocus={!phone}
                onFocus={selectOnce}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>

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
                        ? tCommon("dateOutsideFiscalYear", {
                            year: fiscalYearLabel(fiscalYear!),
                          })
                        : undefined
                }
                // A hint rather than an error: the date is real, it just cannot be sent without a dispens.
                hint={dateTooLate ? tooLateHint : undefined}
              >
                <DateInput
                  min={fiscalYear?.fromDate}
                  max={fiscalYear?.toDate}
                  value={form.purchaseDate}
                  onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
                />
              </Field>
              {/* FieldGroup, not Field: a <label> forwards clicks to the first labelable element, which would be a direction button. */}
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
                        className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
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
          </CardBody>
        </Card>

        {paymentType === "CARD" && (
          <Card>
            <CardBody className="space-y-3">
              <h2 className="flex items-center gap-1.5 text-base font-semibold">
                {t("matchTitle")}
                <MatchHelp />
              </h2>
              <TransactionPicker
                candidates={candidates}
                selectedId={matchId}
                onPick={setMatchId}
                amount={Math.abs(grossSEK)}
                onUseAmount={takeBankAmount}
              />
            </CardBody>
          </Card>
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
                label: existing?.status === "CHANGES_REQUESTED" ? t("resubmit") : t("submit"),
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
