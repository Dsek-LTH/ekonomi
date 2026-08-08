"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useTranslations } from "next-intl";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DetailList, DetailRow } from "@/components/ui/detail-list";
import { Field, FieldGroup, Input, DateInput } from "@/components/ui/field";
import { Stepper } from "@/components/ui/stepper";
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
// React node cannot go — see `matchLead` below.
import { formatSEK } from "@/lib/ui/format";
import { isAmountInput, parseOre, parseSEK, sekToOre } from "@/lib/domain/money";
import type { CreateExpense, PatchExpense } from "@/lib/api/schemas/expense";
import { cancelsOut } from "@/lib/domain/matching";
import type { BankTransaction, CostCenter, Expense, PaymentType } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { AllocationEditor, makeRow } from "@/components/allocation-editor";
import type { AllocationRow } from "@/components/allocation-editor";

// The step keys, named by `expenses.wizard.step.<key>` in messages. The match
// step only exists for card purchases; a reimbursement goes straight from
// review to submit.

// The wizard asks two "pick one of these" questions — the payment type and the
// bank transaction to match. Both are a bordered card that fills with accent
// once chosen.
const optionCard = (selected: boolean) =>
  cn(
    "w-full rounded-xl border px-4 py-3 text-left transition-colors",
    selected ? "border-accent bg-accent-soft" : "border-border hover:bg-surface",
  );

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
  const router = useProgressRouter();
  const t = useTranslations("expenses.wizard");
  const tPayment = useTranslations("common.payment");
  const tBlocker = useTranslations("expenses.submitBlocker");
  const tNav = useTranslations("nav");
  const tReceipt = useTranslations("receipt");
  const tList = useTranslations("expenses");
  const { date } = useFormat();
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
  // CARD is only offered to card holders; the expense being edited keeps its
  // type as an option even if the user no longer holds a card.
  const paymentTypes = PAYMENT_TYPES.filter(
    (pt) => holdsCard || pt !== "CARD" || existing?.paymentType === "CARD",
  );
  const [paymentType, setPaymentType] = useState<PaymentType>(
    existing?.paymentType ?? (holdsCard ? "CARD" : "REIMBURSEMENT"),
  );
  // The step flow depends on payment type: a reimbursement skips "Matcha".
  // Uploading isn't among them — the receipt panel beside the form is where a
  // receipt goes and where it then stays, so it needs no step of its own.
  const stepKeys = paymentType === "CARD"
    ? (["review", "match", "submit"] as const)
    : (["review", "submit"] as const);
  const stepLabels = stepKeys.map((k) => t(`step.${k}`));
  const cur = stepKeys[step] ?? stepKeys[stepKeys.length - 1];
  const [form, setForm] = useState(() => {
    if (existing) {
      return {
        title: existing.title,
        purchaseDate: existing.purchaseDate,
        gross: String(existing.grossAmount),
      };
    }
    return presetTxn
      ? {
          title: presetTxn.description,
          purchaseDate: presetTxn.transactionDate,
          gross: String(-presetTxn.amount),
        }
      : { title: "", purchaseDate: "", gross: "" };
  });
  // The cost centre starts unpicked — choosing one is the submitter's call, and
  // defaulting to whichever happens to sort first invites a wrong one going
  // through unnoticed. submitBlocker refuses to submit until each row has one.
  const [allocations, setAllocations] = useState<AllocationRow[]>(() =>
    existing?.allocations.length
      ? existing.allocations.map((a) =>
          makeRow(a.costCenterCode, String(a.amount), a.comment ?? ""),
        )
      : [makeRow("", presetTxn ? String(-presetTxn.amount) : "")],
  );
  const [matchId, setMatchId] = useState<string | null>(
    existing?.matchedTransactionId ?? (presetTxn ? presetTxn.id : null),
  );
  // One busy scope for the whole wizard: saving and submitting — and the
  // receipt upload inside them — block the same footer.
  const { pending, mutate } = useMutation();
  const saving = pending === "save";
  const saveLabel = editing ? t("save") : t("saveDraft");
  // Which of the two exits is running. `saving` can't tell them apart — both
  // write the same draft through the same key first — and a spinner on both
  // buttons at once would claim the app is doing twice the work it is. Cleared
  // only on failure: on success the page is leaving, and a button that goes
  // idle while you're still looking at the old screen reads as nothing having
  // happened.
  const [exit, setExit] = useState<"draft" | "submit" | null>(null);

  // The utlägg's own id, once there is a row for it. Null all the way through a
  // new utlägg until the moment it is saved — see `persist`. The id and not the
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
  // from yet. Revoked when it is replaced and when the page goes — otherwise
  // the browser holds the file for as long as the tab lives.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // One cleanup covers both ways a preview ends — a second file replacing the
  // first, and the page going away — because either is this value changing.
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
  // page ever asks — every gate here (continue, save, submit) wants "has the
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
    // preview is what makes that happen — kept, it would go on pointing at a
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

  // A match only counts while it still cancels the amount out — editing the
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

  const grossSEK = parseSEK(form.gross);
  // Saving a draft is allowed with fields still empty, but not with a partial
  // date — that would be stored as 1 January of the year typed so far — and not
  // with one that hasn't happened yet, which the server refuses anyway. And not
  // before the receipt: an utlägg is a claim about a purchase, and the receipt
  // is what makes it one. It no longer has to be uploaded by then — a file
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
    allocations: allocations.map((a) => ({
      amount: parseSEK(a.amount),
      costCenterCode: a.costCenterCode,
    })),
  });

  // Everything this wizard writes, in the order it has to happen: the utlägg
  // itself, then its receipt, then the reviewed fields, then the bank match for
  // a card purchase. Nothing before this — a wizard that was opened and left
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
        matchedTransactionId: presetTxn?.id ?? null,
      };
      const created = await mutate<{ id: string }>("/api/expenses", {
        key: "save",
        body: create,
        error: t("createFailed"),
        // Nothing on screen shows it yet — the steps after this one do.
        refresh: false,
      });
      if (!created) return null;
      id = created.id;
      setDraftId(id);
    }
    if (!(await writeReceipt(id))) return null;
    // Öre, both of them. The gross and the rows that have to sum to it cross
    // the wire in the same unit as each other and as the columns they land in —
    // the rows used to go as kronor, which made a figure a hundred times too
    // small look like a distribution that didn't balance. `PatchExpense` is
    // what now says so in a form the compiler reads.
    const patch: PatchExpense = {
      title: form.title,
      purchaseDate: form.purchaseDate || null,
      grossAmount: sekToOre(grossSEK),
      allocations: allocations.map((a) => ({
        costCenterCode: a.costCenterCode,
        amount: parseOre(a.amount),
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
    router.push(`/expenses/${id}`);
    router.refresh();
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

  return (
    <PageShell
      title={
        editing
          ? existing!.reference
            ? t("editTitle", { id: existing!.reference })
            : t("editTitleDraft")
          : t("newTitle")
      }
      description={editing ? t("editDescription") : t("newDescription")}
      back={
        // Editing belongs to the expense it changes; a new one to the list.
        editing
          ? {
              href: `/expenses/${existing!.id}`,
              label: existing!.reference ?? t("draftLabel"),
            }
          : { href: "/expenses", label: tNav("expenses") }
      }
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

      {/* Step 1 — the details, beside the receipt */}
      {cur === "review" && (
        <Card>
          <CardBody className="space-y-5">
            <Field label={t("description")}>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
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
              {/* Not type="number": it drops a lone leading "-" from .value, so a
                  return is awkward to type, and it rejects "1 234,50". parseSEK
                  reads both, and this matches the allocation amount fields.
                  Anything that isn't on its way to an amount — a third decimal
                  included, since öre is as fine as money gets here — is simply
                  not taken, so the field keeps what it had. */}
              <Field label={t("amount")}>
                <Input
                  value={form.gross}
                  inputMode="decimal"
                  onChange={(e) => {
                    if (!isAmountInput(e.target.value)) return;
                    setForm({ ...form, gross: e.target.value });
                    if (allocations.length === 1) {
                      setAllocations([{ ...allocations[0], amount: e.target.value }]);
                    }
                  }}
                />
              </Field>
            </div>

            <FieldGroup label={t("distribution")}>
              <AllocationEditor
                costCenters={selectableCostCenters}
                grossAmount={grossSEK}
                value={allocations}
                onChange={setAllocations}
              />
            </FieldGroup>

            <FieldGroup label={t("paymentType")}>
              <div className="grid gap-3 sm:grid-cols-2">
                {paymentTypes.map((pt) => (
                  <button
                    key={pt}
                    onClick={() => setPaymentType(pt)}
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
                isn't in this card — without saying so, Fortsätt is a dead
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

      {/* Step 2 — match (card purchases only) */}
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
                              {!selectable && ` · ${t("otherAmount")}`}
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

      {/* Final step — review & submit */}
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
                  value={<>{a.costCenterCode} · <Amount value={parseSEK(a.amount)} signed /></>}
                />
              ))}
              <DetailRow label={t("paymentType")} value={tPayment(`${paymentType}.label`)} />
              {paymentType === "CARD" ? (
                <DetailRow
                  label={t("match")}
                  value={bankTransactions.find((tx) => tx.id === matchId)?.description ?? "—"}
                />
              ) : (
                <DetailRow
                  label={t("payoutTo")}
                  value={
                    payoutClearing && payoutAccount
                      ? `${payoutClearing} · ${payoutAccount}`
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
              <p className="text-xs text-warning">
                {tBlocker(blocker, { days: REIMBURSEMENT_DEADLINE_DAYS })}
              </p>
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
  /** The draft save this footer owns is in flight — not the step's own action. */
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
