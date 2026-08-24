"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { IconCheck } from "@/components/ui/icons";
import { useRole } from "@/components/shell/role-context";
import { useMutation } from "@/components/shell/use-mutation";
import { canBookkeep } from "@/lib/domain/permissions";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { expenseDocuments } from "@/lib/expense/document-url";
import { PageShell } from "@/components/page-shell";
import {
  BalanceChip,
  filledVoucherRows,
  VoucherBlockerChip,
  VoucherEditor,
  type VoucherEditorRow,
} from "@/components/voucher-editor";
import type { AccountRecord, BookkeepingSettings } from "@/lib/domain/types";
// The out-of-balance difference is set inside a sentence, so that one stays a
// string — everything else on this page is an Amount.
import { formatSEK } from "@/lib/ui/format";
import { oreToSEK, parseOre, sekToOre } from "@/lib/domain/money";
import { voucherBalance, voucherBlocker } from "@/lib/domain/voucher";
import { expenseLabel } from "@/lib/domain/reference";
import { DateInput, Field } from "@/components/ui/field";
import { uid } from "@/lib/ui/utils";
import { useSelectOnce } from "@/lib/ui/use-select-once";
import type { CostCenter, Expense } from "@/lib/domain/types";
import { useProgressRouter } from "@/components/shell/route-progress";

// The rows are the shared editor's shape — see components/voucher-editor.tsx.
type Row = VoucherEditorRow;

// The amount columns hold text, not type="number": that drops a lone leading
// "-" from .value (a return is booked with the sign flipped) and rejects
// "1 234,50". What may be typed is the shape parseSEK reads instead — see
// isAmountInput in lib/domain/money.ts, which is also what the wizard's amount
// fields accept, so an amount can't be typed one way there and another here.

// Which account the money moves from. A card purchase already left the section's
// bank; a private outlay is a debt to the member until it's paid back. That
// follows from the payment type, so it is not the bookkeeper's to choose — see
// the locked credit row in the table below.
function paymentAccountFor(expense: Expense, settings: BookkeepingSettings): string {
  return expense.paymentType === "CARD" ? settings.bankAccount : settings.memberDebtAccount;
}

// Suggest the debit side from the expense's cost allocations. The credit side
// is never suggested — it is fixed. VAT is no longer stored on the expense, so
// split it out manually here if needed.
function defaultDebitRows(expense: Expense | undefined): Row[] {
  if (!expense) return [];
  const gross = expense.grossAmount;
  if (expense.allocations.length > 0) {
    return expense.allocations.map((a) => ({
      id: uid(),
      account: "",
      description: "",
      costCenterCode: a.costCenterCode,
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
      debit: gross ? gross.toFixed(2) : "",
      credit: "",
    },
  ];
}

// Existing voucher → editable rows (when amending a booked verification). The
// payment row is dropped: it isn't editable, and it gets re-added on save. That
// also normalises any voucher booked before the row was locked.
function debitRowsFromVerification(expense: Expense, paymentAccount: string): Row[] {
  return (expense.verification?.lines ?? [])
    .filter((l) => !(l.account === paymentAccount && l.credit > 0))
    .map((l) => ({
      id: l.id,
      account: l.account,
      description: l.description ?? "",
      costCenterCode: l.costCenterCode ?? "",
      debit: l.debit ? l.debit.toFixed(2) : "",
      credit: l.credit ? l.credit.toFixed(2) : "",
    }));
}

export default function BookExpenseClient({
  expense,
  costCenters,
  accounts,
  settings,
}: {
  expense: Expense | null;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  settings: BookkeepingSettings;
}) {
  const router = useProgressRouter();
  const t = useTranslations("book");
  const tDetail = useTranslations("expenses.detail");
  const tReceipt = useTranslations("receipt");
  const { user } = useRole();
  const { busy: submitting, mutate } = useMutation();
  // The voucher date opens focused and full — see the field below.
  const selectOnce = useSelectOnce();
  // `expense` is still nullable here — the not-found case is narrowed further
  // down — and expenseDocuments takes that; the alt text has to as well.
  const documents = expenseDocuments(expense, `${tReceipt("alt")} · ${expense?.title ?? ""}`);

  const accountName = (number: string) =>
    accounts.find((a) => a.number === number.trim())?.name ?? "";
  const accountExists = (n: string) => accounts.some((a) => a.number === n.trim());

  // APPROVED → create a voucher; BOOKED → amend it (before export).
  const mode: "create" | "edit" | null =
    expense?.status === "APPROVED" ? "create" : expense?.status === "BOOKED" ? "edit" : null;

  // The voucher text always starts with a fixed, non-editable prefix: the
  // submitter's StiL id for a card purchase, "PU <stilid>" for a reimbursement.
  // The user can only append free text after it.
  const textPrefix = expense
    ? expense.paymentType === "CARD"
      ? expense.submitterStudentId
      : `PU ${expense.submitterStudentId}`
    : "";

  const [date, setDate] = useState(
    () => expense?.verification?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [textSuffix, setTextSuffix] = useState(() => {
    const full = expense?.verification?.description ?? expense?.title ?? "";
    // Vouchers booked before the prefix became the StiL id still carry the name
    // form; strip that too, or amending one would prepend the new prefix to the
    // old one and keep the name in the text forever.
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
  // `rows` holds the DEBIT side only. The credit row is derived from the
  // expense and rendered separately, which is what makes it unremovable.
  const paymentAccount = expense ? paymentAccountFor(expense, settings) : "";
  const [rows, setRows] = useState<Row[]>(() =>
    expense?.status === "BOOKED"
      ? debitRowsFromVerification(expense, paymentAccount)
      : defaultDebitRows(expense ?? undefined),
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

  const mayBook = canBookkeep(user.roles);
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
          expense.status === "EXPORTED"
            ? t("lockedDescription")
            : t("notBookableDescription")
        }
        action={<ButtonLink href={`/expenses/${expense.id}`}>{t("toExpense")}</ButtonLink>}
      />
    );
  }

  // The locked credit row is always the full gross — the debit side is what has
  // to be made to match it, never the other way round.
  const paymentCredit = expense.grossAmount;
  const paymentText = t(expense.paymentType === "CARD" ? "paymentCard" : "paymentPrivate");

  // The voucher exactly as it will be posted, built once: the locked payment row
  // (kept out of `rows` so there is no state the UI could let anyone edit it
  // through) followed by the typed ones. `save()` sends this and the check below
  // reads it, so the button can only be live for a voucher the server accepts.
  //
  // Without the spare rows the editor keeps at the bottom of the table: they are
  // where the next line would be written, not lines. Left in, every voucher
  // would be three blank rows short of bookable.
  const typedRows = filledVoucherRows(rows);
  const voucherLines = [
    {
      account: paymentAccount,
      accountName: accountName(paymentAccount),
      description: paymentText,
      costCenterCode: null as string | null,
      debit: 0,
      credit: sekToOre(paymentCredit),
    },
    ...typedRows.map((r) => ({
      account: r.account.trim(),
      accountName: accountName(r.account),
      description: r.description || null,
      costCenterCode: r.costCenterCode || null,
      debit: parseOre(r.debit),
      credit: parseOre(r.credit),
    })),
  ];

  // Counted in öre and converted for display, never the other way round: a
  // difference of one öre is a real difference, and summing kronor floats would
  // hide it behind a rounding.
  const balance = voucherBalance(voucherLines);
  const totalDebit = oreToSEK(balance.debit);
  const totalCredit = oreToSEK(balance.credit);
  const diff = oreToSEK(balance.difference);
  // Two questions, not one. The chip answers whether the voucher adds up; the
  // blocker answers whether it may be written, which is the stricter of the two
  // and is what the button waits on. Reading the chip off the blocker meant an
  // unpicked account showed as "differs by 0,00 kr" — the sides met, and the
  // screen said they didn't.
  const blocker = voucherBlocker(voucherLines);
  const balanced = balance.balanced;
  const costCenterExists = (code: string) => costCenters.some((c) => c.code === code.trim());
  const allValidAccounts = typedRows.every((r) => accountExists(r.account));
  const allValidCostCenters = typedRows.every(
    (r) => !r.costCenterCode.trim() || costCenterExists(r.costCenterCode),
  );
  // A payment account that isn't in the chart is a settings problem, not
  // something to book around — see the banner below.
  const paymentAccountKnown = accountExists(paymentAccount);
  const canSubmit =
    !blocker && allValidAccounts && allValidCostCenters && paymentAccountKnown && !submitting;

  async function save() {
    const saved = await mutate(`/api/expenses/${expense!.id}/book`, {
      method: mode === "edit" ? "PATCH" : "POST",
      body: { date, description: voucherText, lines: voucherLines },
      error: t("saveFailed"),
    });
    if (!saved) return;
    router.push(`/expenses/${expense!.id}`);
    router.refresh();
  }

  // Anything bookable has been through attest, so it has a reference; the
  // fallback is only here so the page can't render a blank where a name goes.
  const label = expenseLabel(expense);

  return (
    <PageShell
      title={mode === "edit" ? t("editTitle", { id: label }) : t("createTitle", { id: label })}
      description={mode === "edit" ? t("editDescription") : t("createDescription")}
      back={{ href: `/expenses/${expense.id}`, label }}
      width="wide"
    >

      {/* The receipt stands beside the whole frame, full height, and stays put
          while this table scrolls — which is the entire point of booking with
          it open. Declared here, rendered by the shell. */}
      {/* The utläggsräkning as well as the underlag: the cover page naming who
          attested each cost centre, and behind it the receipt itself, paged to
          from the toolbar. This is the screen where that matters most — those
          two are exactly what this booking will put on the voucher in Fortnox,
          so the bookkeeper is reading what they are about to send rather than
          half of it. See lib/expense/document-url.ts. */}
      <ReceiptPanelSource
        documents={documents}
        // Said in the panel, not in the page. A voucher with no underlag is
        // something the bookkeeper has to know about, and it belongs where the
        // underlag would have been — so the voucher table sits in the same
        // place whether there's a receipt beside it or not.
        //
        // It is also why the cover is not stood here on its own when there is
        // no receipt: it would fill the panel with a document and take away the
        // one thing the panel is here to say.
        emptyTitle={t("noReceiptTitle")}
        emptyDescription={t("noReceiptDescription")}
      />

      <div className="grid gap-6">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <Field label={t("voucherDate")}>
            {/* Where the booking starts, so it is where the cursor starts. The
                field already holds a date — the utlägg's own — so it is
                selected as well as focused: the mask takes eight digits and no
                more, and typing into a full one would otherwise do nothing at
                all. Once, on arrival; clicking back in later to fix a single
                digit behaves as it should. */}
            <DateInput
              autoFocus
              onFocus={selectOnce}
              size="sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label={t("voucherText")}>
            {/* Prefix and input are one field, so the ring goes round the pair
                — focus-ring-within draws it on the box and suppresses the
                input's own (see globals.css). */}
            <div className="focus-ring-within flex h-11 w-full items-center rounded-lg border border-border bg-background px-2.5 text-sm sm:h-9">
              {/* The prefix comes from the submitter's identity, so its width is
                  out of our hands. Nowrap-and-never-shrink made the box wider
                  than the card body on a long one; it truncates instead, and the
                  input keeps a usable minimum before that ever happens. */}
              <span className="min-w-0 truncate font-medium text-muted" title={t("prefixLocked")}>
                {textPrefix}
              </span>
              <input
                value={textSuffix}
                onChange={(e) => setTextSuffix(e.target.value)}
                placeholder={t("voucherTextPlaceholder")}
                aria-label={t("voucherTextAria")}
                className="ml-1.5 w-0 min-w-[8ch] flex-1 bg-transparent placeholder:text-muted/50"
              />
            </div>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("lines")} subtitle={t("linesHint")} />
        <VoucherEditor
          rows={rows}
          onChange={setRows}
          accounts={accounts}
          costCenters={costCenters}
          // The payment row. Which account the money comes from follows from
          // the payment type, and the amount is the expense's — so there is
          // nothing here to choose, and no ✕ to remove it with.
          locked={{
            account: paymentAccount,
            accountName: accountName(paymentAccount),
            description: paymentText,
            debit: 0,
            credit: paymentCredit,
            hint: t("lockedRowHint"),
            label: t("lockedRow"),
          }}
          totalDebit={totalDebit}
          totalCredit={totalCredit}
        />

        {!paymentAccountKnown && (
          <div className="px-inset pb-4">
            <Notice>
              {t("unknownPaymentAccount", { account: paymentAccount || t("notSet") })}
            </Notice>
          </div>
        )}

        <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
          <BalanceChip balanced={balanced} difference={formatSEK(diff)} />

          <div className="flex items-center gap-2.5">
            {/* Why the button is dead. Without it, making the chip tell the
                truth about a balanced voucher would have left an unpicked
                account with no signal at all — a green chip over a button that
                quietly refuses. It says nothing when the balance chip is
                already saying it. */}
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
