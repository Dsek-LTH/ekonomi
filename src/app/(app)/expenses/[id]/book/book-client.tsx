"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { IconCheck } from "@/components/ui/icons";
import { useRole } from "@/components/shell/role-context";
import { useMutation } from "@/components/shell/use-mutation";
import { useConfirm } from "@/components/confirm-dialog";
import { useFormat } from "@/lib/ui/use-format";
import { canBookkeep } from "@/lib/domain/permissions";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { expenseDocuments } from "@/lib/expense/document-url";
import { PageShell } from "@/components/page-shell";
import {
  BalanceChip,
  filledVoucherRows,
  VoucherBlockerChip,
  VoucherCostCenterPicker,
  VoucherEditor,
  type VoucherEditorRow,
} from "@/components/voucher-editor";
import type { AccountRecord, BookkeepingSettings, ProjectRecord } from "@/lib/domain/types";
// The out-of-balance difference is set inside a sentence, so that one stays a
// string. Everything else on this page is an Amount.
import { formatSEK } from "@/lib/ui/format";
import { oreToSEK, parseOre, sekToOre } from "@/lib/domain/money";
import { isRevenueAccount, voucherBalance, voucherBlocker } from "@/lib/domain/voucher";
import { voucherTextPrefix } from "@/lib/domain/review";
import { expenseLabel } from "@/lib/domain/reference";
import { DateInput, Field, Input } from "@/components/ui/field";
import { uid } from "@/lib/ui/utils";
import { useSelectOnce } from "@/lib/ui/use-select-once";
import type { CostCenter, Expense } from "@/lib/domain/types";
import { useReturnTo } from "@/components/shell/route-history";
import { withCostCenterTag } from "@/lib/domain/cost-center-tag";
import { useFiscalYear } from "@/components/shell/fiscal-year-context";
import { fiscalYearLabel, outsideFiscalYear } from "@/lib/ui/fiscal-year";
import { useBookingPresence } from "./use-booking-presence";
import { OthersBookingNotice, UpdatedElsewhere } from "./presence-notices";
import { isoDay } from "@/lib/domain/date";

type Row = VoucherEditorRow;

// The amount columns hold text, not type="number": that drops a lone leading "-" and rejects "1 234,50".
// Same accepted shape as the wizard (isAmountInput in lib/domain/money.ts).

// Which account the money moves from follows from the payment type (a card purchase left the section's bank, a private outlay is a debt
// to the member), so it is not the bookkeeper's to choose. Null when the setting is not chosen: then nothing can be konterat.
function paymentAccountFor(expense: Expense, settings: BookkeepingSettings): string | null {
  return expense.paymentType === "CARD" ? settings.bankAccount : settings.memberDebtAccount;
}

// The payment row's two sides, in kronor. A return (negative gross) is the same row the other way round,
// a debit of the magnitude: a voucher holds no negative amounts (voucherBlocker).
function paymentSides(gross: number): { debit: number; credit: number } {
  return gross < 0 ? { debit: -gross, credit: 0 } : { debit: 0, credit: gross };
}

// Suggest the debit side from the cost allocations. The credit side is fixed. A local cost centre's code starts in the row text (lib/domain/cost-center-tag).
function defaultDebitRows(expense: Expense | undefined, costCenters: CostCenter[]): Row[] {
  if (!expense) return [];
  const gross = expense.grossAmount;
  // A return has its payment row on the debit side, so the suggestion goes on
  // the credit side, as the magnitude.
  const isReturn = gross < 0;
  const amount = gross ? Math.abs(gross).toFixed(2) : "";
  if (expense.allocations.length > 0) {
    const isLocal = (code: string) =>
      costCenters.some((c) => c.code === code && c.source === "LOCAL");
    return expense.allocations.map((a) => ({
      id: uid(),
      account: "",
      description: isLocal(a.costCenterCode) ? withCostCenterTag("", a.costCenterCode) : "",
      costCenterCode: a.costCenterCode,
      project: "",
      debit: "",
      credit: "",
    }));
  }
  return [
    {
      id: uid(),
      account: "",
      description: "",
      costCenterCode: "",
      project: "",
      debit: isReturn ? "" : amount,
      credit: isReturn ? amount : "",
    },
  ];
}

// Existing voucher to editable rows. The payment row is dropped (not editable, re-added on save), which also normalises vouchers booked before it was locked.
function debitRowsFromVerification(expense: Expense, paymentAccount: string): Row[] {
  const isReturn = expense.grossAmount < 0;
  return (expense.verification?.lines ?? [])
    .filter((l) => !(l.account === paymentAccount && (isReturn ? l.debit : l.credit) > 0))
    .map((l) => ({
      id: l.id,
      account: l.account,
      description: l.description ?? "",
      costCenterCode: l.costCenterCode ?? "",
      project: l.project ?? "",
      debit: l.debit ? l.debit.toFixed(2) : "",
      credit: l.credit ? l.credit.toFixed(2) : "",
    }));
}

export default function BookExpenseClient({
  expense,
  costCenters,
  accounts,
  projects,
  settings,
  returnHref,
}: {
  expense: Expense | null;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  projects: ProjectRecord[];
  /** Where saving, and the back arrow, lead: the utlägg, or the review. */
  returnHref: string;
  settings: BookkeepingSettings;
}) {
  const returnTo = useReturnTo();
  const t = useTranslations("book");
  const tDetail = useTranslations("expenses.detail");
  const tReceipt = useTranslations("receipt");
  const tCommon = useTranslations("common");
  const fiscalYear = useFiscalYear();
  const { user } = useRole();
  const { busy: submitting, mutate } = useMutation();
  const confirm = useConfirm();
  const { list } = useFormat();
  const selectOnce = useSelectOnce();
  // `expense` is still nullable here: the not-found case is narrowed further down.
  const documents = expenseDocuments(expense, `${tReceipt("alt")} - ${expense?.title ?? ""}`, {
    cover: tReceipt("coverLabel"),
    underlag: tReceipt("underlagLabel"),
  });

  const accountName = (number: string) =>
    accounts.find((a) => a.number === number.trim())?.name ?? "";
  const accountExists = (n: string) => accounts.some((a) => a.number === n.trim());

  // APPROVED → create a voucher; BOOKED → amend it (before export).
  const mode: "create" | "edit" | null =
    expense?.status === "APPROVED" ? "create" : expense?.status === "BOOKED" ? "edit" : null;

  // Who else has this utlägg open, and whether somebody saved it meanwhile. Only for a screen that can book (use-booking-presence.ts).
  const presence = useBookingPresence(
    expense && mode && canBookkeep(user.capabilities) ? expense.id : null,
    expense?.updatedAt ?? null,
  );

  // The voucher text always starts with a fixed, non-editable prefix: the
  // submitter's StiL id for a card purchase, "PU <stilid>" for a reimbursement.
  // The user can only append free text after it.
  const textPrefix = expense
    ? voucherTextPrefix(expense.paymentType, expense.submitterStudentId)
    : "";

  // Amending: the voucher's own date. Booking: the day of the purchase. `||` not `??`: purchaseDate is "" when there is none (isoDate in lib/data/shared.ts).
  const [date, setDate] = useState(
    () => expense?.verification?.date.slice(0, 10) || expense?.purchaseDate || isoDay(new Date()),
  );
  // Why the date differs from the utlägg's, when it does. Saving then corrects
  // the utlägg to match, so the two never disagree. See lib/domain/correction.ts.
  const [correctionReason, setCorrectionReason] = useState("");
  const [textSuffix, setTextSuffix] = useState(() => {
    const full = expense?.verification?.description ?? expense?.title ?? "";
    // Vouchers booked before the prefix became the StiL id carry the name form: strip it too, or amending would keep the name in the text.
    const legacyPrefix = expense
      ? expense.paymentType === "CARD"
        ? expense.submitterName
        : `PU ${expense.submitterName}`
      : "";
    for (const prefix of [textPrefix, legacyPrefix]) {
      if (prefix && full.startsWith(prefix)) return full.slice(prefix.length).trim();
    }
    return full;
  });
  const voucherText = textSuffix.trim() ? `${textPrefix} ${textSuffix.trim()}` : textPrefix;
  // `rows` holds every row but the payment one, derived from the expense and rendered separately so it is unremovable.
  const paymentAccountSetting = expense ? paymentAccountFor(expense, settings) : null;
  // Drawn with no account while the setting is unchosen.
  const paymentAccount = paymentAccountSetting ?? "";
  const [rows, setRows] = useState<Row[]>(() =>
    expense?.status === "BOOKED"
      ? debitRowsFromVerification(expense, paymentAccount)
      : defaultDebitRows(expense ?? undefined, costCenters),
  );

  if (!expense) {
    return (
      <EmptyState
        title={tDetail("missingTitle")}
        description={tDetail("missingDescription")}
        action={<ButtonLink href="/expenses">{tDetail("missingAction")}</ButtonLink>}
      />
    );
  }

  const mayBook = canBookkeep(user.capabilities);
  if (!mayBook) {
    return (
      <EmptyState
        title={t("noAccessTitle")}
        description={t("noAccessDescription")}
        action={<ButtonLink href={`/expenses/${expense.id}`}>{t("backToExpense")}</ButtonLink>}
      />
    );
  }
  if (!mode) {
    return (
      <EmptyState
        title={expense.status === "EXPORTED" ? t("lockedTitle") : t("notBookableTitle")}
        description={
          expense.status === "EXPORTED" ? t("lockedDescription") : t("notBookableDescription")
        }
        action={<ButtonLink href={`/expenses/${expense.id}`}>{t("toExpense")}</ButtonLink>}
      />
    );
  }

  // The locked payment row is always the full gross. The other rows are what
  // have to be made to match it, never the other way round.
  const payment = paymentSides(expense.grossAmount);

  // The voucher exactly as posted, built once: the locked payment row followed by the typed ones, without the editor's spare bottom rows.
  // `save()` sends this and the check reads it, so the button is live only for a voucher the server accepts.
  const typedRows = filledVoucherRows(rows);
  const voucherLines = [
    {
      account: paymentAccount,
      accountName: accountName(paymentAccount),
      // No row text: the account and the voucher text's prefix already say card or private.
      description: null,
      costCenterCode: null as string | null,
      project: null as string | null,
      debit: sekToOre(payment.debit),
      credit: sekToOre(payment.credit),
    },
    ...typedRows.map((r) => ({
      account: r.account.trim(),
      accountName: accountName(r.account),
      description: r.description || null,
      costCenterCode: r.costCenterCode || null,
      project: r.project?.trim() || null,
      debit: parseOre(r.debit),
      credit: parseOre(r.credit),
    })),
  ];

  // Counted in öre and converted for display: a one-öre difference is real and kronor floats would hide it.
  const balance = voucherBalance(voucherLines);
  const totalDebit = oreToSEK(balance.debit);
  const totalCredit = oreToSEK(balance.credit);
  const diff = oreToSEK(balance.difference);
  // The chip answers whether the voucher adds up, the blocker whether it may be written (the stricter of the two).
  // Reading the chip off the blocker showed "differs by 0,00 kr" for an unpicked account.
  const blocker = voucherBlocker(voucherLines);
  const balanced = balance.balanced;
  const costCenterExists = (code: string) => costCenters.some((c) => c.code === code.trim());
  const allValidAccounts = typedRows.every((r) => accountExists(r.account));
  const allValidCostCenters = typedRows.every(
    (r) => !r.costCenterCode.trim() || costCenterExists(r.costCenterCode),
  );
  const allValidProjects = typedRows.every(
    (r) => !r.project?.trim() || projects.some((p) => p.number === r.project!.trim()),
  );
  // Intäktskonton the voucher already carries (written before the rule): the picker no longer offers them and the server refuses them (isRevenueAccount).
  const revenueAccounts = [
    ...new Set(typedRows.map((r) => r.account.trim()).filter(isRevenueAccount)),
  ];
  // A payment account missing from the chart is a settings problem (see the banner below).
  const paymentAccountKnown = accountExists(paymentAccount);
  // Not on a version somebody else has replaced (the server refuses too), so the button says so first.
  // A new voucher is in the year picked in the header, as the route holds.
  const dateOutsideYear =
    date !== expense?.verification?.date.slice(0, 10) && outsideFiscalYear(fiscalYear, date);
  // A voucher on another day than the utlägg says is a correction of the
  // utlägg. An utlägg with no date simply takes the voucher's.
  const correcting = Boolean(expense.purchaseDate) && date !== expense.purchaseDate;
  const canSubmit =
    !blocker &&
    !dateOutsideYear &&
    (!correcting || correctionReason.trim() !== "") &&
    allValidAccounts &&
    allValidCostCenters &&
    allValidProjects &&
    revenueAccounts.length === 0 &&
    paymentAccountKnown &&
    !submitting &&
    !presence.stale;

  async function save() {
    // Somebody else has it open. Not a lock, but whoever saves second starts over.
    const { others } = presence;
    if (others.length > 0) {
      const ok = await confirm({
        title: t("presence.confirmTitle"),
        message: t("presence.confirmMessage", {
          names: list(others.map((o) => o.name)),
          count: others.length,
        }),
        confirmLabel: mode === "edit" ? t("saveChanges") : t("book"),
      });
      if (!ok) return;
    }

    presence.pause();
    const saved = await mutate(`/api/expenses/${expense!.id}/book`, {
      method: mode === "edit" ? "PATCH" : "POST",
      // The version this screen was built from. If it is no longer the
      // utlägg's, the server answers 409 rather than overwriting.
      body: {
        expectedUpdatedAt: expense!.updatedAt,
        date,
        description: voucherText,
        lines: voucherLines,
        ...(correcting && { correctionReason: correctionReason.trim() }),
      },
      error: t("saveFailed"),
    });
    if (!saved) {
      // Possibly a 409 because somebody got there first: asking at once turns the toast into the reload dialog.
      presence.resume();
      return;
    }
    // Back out rather than pushing the utlägg in front, or the first Back lands in the booking form for a booked utlägg. `returnTo` refreshes the utlägg.
    returnTo(returnHref);
  }

  // Anything bookable has a reference; the fallback only avoids a blank name.
  const label = expenseLabel(expense);

  return (
    <PageShell
      title={t.rich(mode === "edit" ? "editTitle" : "createTitle", {
        id: () => (
          <Link
            href={`/expenses/${expense.id}`}
            className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
          >
            {label}
          </Link>
        ),
      })}
      back={returnHref}
      width="wide"
    >
      {/* The receipt and, behind it, the cover naming who attested each cost centre: what this booking puts on the voucher in Fortnox (lib/expense/document-url.ts). */}
      <ReceiptPanelSource documents={documents} />

      <div className="grid gap-6">
        <div className="min-w-0 space-y-4">
          {presence.stale ? (
            <UpdatedElsewhere by={presence.stale.by} />
          ) : (
            <OthersBookingNotice others={presence.others} />
          )}
          <Card>
            <CardBody className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)_240px]">
              <Field
                label={t("voucherDate")}
                requirement="required"
                error={
                  dateOutsideYear
                    ? tCommon("dateOutsideFiscalYear", {
                        year: fiscalYearLabel(fiscalYear!),
                      })
                    : undefined
                }
              >
                {/* Selected as well as focused: the mask takes eight digits, so typing into a full date would do nothing. Once, on arrival. */}
                <DateInput
                  min={fiscalYear?.fromDate}
                  max={fiscalYear?.toDate}
                  autoFocus
                  onFocus={selectOnce}
                  size="sm"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label={t("voucherText")} requirement="optional">
                {/* Prefix and input are one field, so the ring goes round the pair (focus-ring-within, globals.css). */}
                <div className="focus-ring-within flex h-11 w-full items-center rounded-control border border-border-control bg-background px-2.5 text-sm sm:h-8">
                  {/* The prefix width is out of our hands: it truncates instead of widening the box. */}
                  <span
                    className="min-w-0 truncate font-medium text-muted"
                    title={t("prefixLocked")}
                  >
                    {textPrefix}
                  </span>
                  <input
                    value={textSuffix}
                    onChange={(e) => setTextSuffix(e.target.value)}
                    placeholder={t("voucherTextPlaceholder")}
                    aria-label={t("voucherTextAria")}
                    className="ml-1.5 w-0 min-w-[8ch] flex-1 bg-transparent placeholder:text-muted"
                  />
                </div>
              </Field>
              <Field label={t("allCostCenter")} requirement="optional">
                <VoucherCostCenterPicker rows={rows} onChange={setRows} costCenters={costCenters} />
              </Field>
            </CardBody>
            {correcting && (
              <CardBody className="border-t border-border">
                <Field label={t("correction.reason")} requirement="required">
                  <Input
                    size="sm"
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder={t("correction.placeholder")}
                  />
                </Field>
              </CardBody>
            )}
          </Card>

          <Card>
            <VoucherEditor
              rows={rows}
              onChange={setRows}
              accounts={accounts}
              costCenters={costCenters}
              projects={projects}
              // The payment row: the account follows from the payment type and the amount is the expense's, so nothing to choose and no ✕.
              locked={{
                account: paymentAccount,
                accountName: accountName(paymentAccount),
                debit: payment.debit,
                credit: payment.credit,
                hint: t("lockedRowHint"),
                label: t("lockedRow"),
              }}
              totalDebit={totalDebit}
              totalCredit={totalCredit}
            />

            {revenueAccounts.length > 0 && (
              <div className="px-inset pb-4">
                <Notice>{t("revenueAccounts", { list: revenueAccounts.join(", ") })}</Notice>
              </div>
            )}

            {!paymentAccountKnown && (
              <div className="px-inset pb-4">
                <Notice>
                  {paymentAccountSetting === null
                    ? t(
                        expense.paymentType === "CARD"
                          ? "bankAccountUnset"
                          : "memberDebtAccountUnset",
                      )
                    : t("unknownPaymentAccount", { account: paymentAccount })}
                </Notice>
              </div>
            )}

            <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
              <BalanceChip balanced={balanced} difference={formatSEK(diff)} />

              <div className="flex items-center gap-2.5">
                {/* Why the button is dead, so a green chip is not left over a button that quietly refuses. */}
                <VoucherBlockerChip blocker={blocker} />
                <Button onClick={save} loading={submitting} disabled={!canSubmit}>
                  <IconCheck className="size-4" />
                  {mode === "edit" ? t("saveChanges") : t("book")}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
