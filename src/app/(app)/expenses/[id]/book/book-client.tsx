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
// string. Everything else on this page is an Amount.
import { formatSEK } from "@/lib/ui/format";
import { oreToSEK, parseOre, sekToOre } from "@/lib/domain/money";
import { voucherBalance, voucherBlocker } from "@/lib/domain/voucher";
import { expenseLabel } from "@/lib/domain/reference";
import { DateInput, Field } from "@/components/ui/field";
import { cn, uid } from "@/lib/ui/utils";
import { useSelectOnce } from "@/lib/ui/use-select-once";
import type { CostCenter, Expense } from "@/lib/domain/types";
import { useReturnTo } from "@/components/shell/route-history";

// The rows are the shared editor's shape. See components/voucher-editor.tsx.
type Row = VoucherEditorRow;

// The amount columns hold text, not type="number": that drops a lone leading
// "-" from .value (a return is booked with the sign flipped) and rejects
// "1 234,50". What may be typed is the shape parseSEK reads instead. See
// isAmountInput in lib/domain/money.ts, which is also what the wizard's amount
// fields accept, so an amount can't be typed one way there and another here.

// Which account the money moves from. A card purchase already left the section's
// bank; a private outlay is a debt to the member until it's paid back. That
// follows from the payment type, so it is not the bookkeeper's to choose. See
// the locked credit row in the table below.
function paymentAccountFor(expense: Expense, settings: BookkeepingSettings): string {
  return expense.paymentType === "CARD" ? settings.bankAccount : settings.memberDebtAccount;
}

// Suggest the debit side from the expense's cost allocations. The credit side
// is never suggested. It is fixed. VAT is no longer stored on the expense, so
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
  payout,
}: {
  expense: Expense | null;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  settings: BookkeepingSettings;
  /**
   * Where to send the money, on an utlägg the section owes somebody. Null on a
   * sektionskort purchase, which is already paid, and on an utlägg that is not
   * here at all.
   *
   * Either field can be empty: a member who has cleared their profile since the
   * utlägg was attested leaves a claim with nowhere to pay it to. The card says
   * so rather than drawing a blank line, because the bookkeeper is otherwise
   * left looking for digits that are not coming.
   */
  payout: { clearing: string; account: string } | null;
}) {
  const returnTo = useReturnTo();
  const t = useTranslations("book");
  const tDetail = useTranslations("expenses.detail");
  const tReceipt = useTranslations("receipt");
  const { user } = useRole();
  const { busy: submitting, mutate } = useMutation();
  // The voucher date opens focused and full. See the field below.
  const selectOnce = useSelectOnce();
  // `expense` is still nullable here. The not-found case is narrowed further
  // down, and expenseDocuments takes that; the alt text has to as well.
  const documents = expenseDocuments(
    expense,
    `${tReceipt("alt")} – ${expense?.title ?? ""}`,
    // The panel stacks the two into one scroll, so each is captioned.
    { cover: tReceipt("coverLabel"), underlag: tReceipt("underlagLabel") },
  );

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

  // Amending: the voucher's own date. Booking: the day of the purchase, which
  // is what the utlägg is about. Today was neither, and dated every voucher the
  // day the bookkeeper happened to open it.
  //
  // `||` rather than `??`: purchaseDate is "" when the utlägg has none (see
  // isoDate in lib/data/shared.ts), and an empty string has to fall through.
  const [date, setDate] = useState(
    () =>
      expense?.verification?.date?.slice(0, 10) ||
      expense?.purchaseDate ||
      new Date().toISOString().slice(0, 10),
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
          expense.status === "EXPORTED"
            ? t("lockedDescription")
            : t("notBookableDescription")
        }
        action={<ButtonLink href={`/expenses/${expense.id}`}>{t("toExpense")}</ButtonLink>}
      />
    );
  }

  // The locked credit row is always the full gross. The debit side is what has
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
  // unpicked account showed as "differs by 0,00 kr". The sides met, and the
  // screen said they didn't.
  const blocker = voucherBlocker(voucherLines);
  const balanced = balance.balanced;
  const costCenterExists = (code: string) => costCenters.some((c) => c.code === code.trim());
  const allValidAccounts = typedRows.every((r) => accountExists(r.account));
  const allValidCostCenters = typedRows.every(
    (r) => !r.costCenterCode.trim() || costCenterExists(r.costCenterCode),
  );
  // A payment account that isn't in the chart is a settings problem, not
  // something to book around. See the banner below.
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
    // Back out of the form rather than pushing the utlägg in front of it:
    // the utlägg is the entry we came from, and pushing it made the first Back
    // press land in the booking form for an already-booked utlägg. `returnTo`
    // refreshes the utlägg once it is reached, which is what shows the voucher
    // that was just written.
    returnTo(`/expenses/${expense!.id}`);
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
          while this table scrolls, which is the entire point of booking with
          it open. Declared here, rendered by the shell. */}
      {/* The underlag as well as the utläggsräkning: the receipt itself, and
          behind it the cover page naming who attested each cost centre, paged
          to from the toolbar. This is the screen where that matters most,
          those two are exactly what this booking will put on the voucher in
          Fortnox, so the bookkeeper is reading what they are about to send
          rather than half of it. It opens on the receipt, since that is the
          document the voucher is being written from; the attest trail is the
          page behind. See lib/expense/document-url.ts. */}
      <ReceiptPanelSource
        documents={documents}
        // Said in the panel, not in the page. A voucher with no underlag is
        // something the bookkeeper has to know about, and it belongs where the
        // underlag would have been, so the voucher table sits in the same
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
          <Field label={t("voucherDate")} requirement="required">
            {/* Where the booking starts, so it is where the cursor starts. The
                field already holds a date, the utlägg's own, so it is
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
          <Field label={t("voucherText")} requirement="optional">
            {/* Prefix and input are one field, so the ring goes round the pair
                (focus-ring-within draws it on the box and suppresses the
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
                className="ml-1.5 w-0 min-w-[8ch] flex-1 bg-transparent placeholder:text-muted"
              />
            </div>
          </Field>
        </CardBody>
      </Card>

      {payout && (
        <PayoutCard name={expense.submitterName} payout={payout} />
      )}

      <Card>
        <CardHeader title={t("lines")} subtitle={t("linesHint")} />
        <VoucherEditor
          rows={rows}
          onChange={setRows}
          accounts={accounts}
          costCenters={costCenters}
          // The payment row. Which account the money comes from follows from
          // the payment type, and the amount is the expense's, so there is
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
                account with no signal at all: a green chip over a button that
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

/**
 * Where the money goes, on the screen where somebody is about to send it.
 *
 * Booking an eget utlägg is two acts a bookkeeper performs one after the other:
 * writing the verifikat, and paying the member back. The second one needs a
 * clearing and account number, and until now this page had neither, so it meant
 * leaving the voucher half-written to go and find them somewhere else.
 *
 * Only here. Every other screen is given `submitterHasPayout`, a yes or no, and
 * that is deliberate: somebody's bank details are theirs and the treasury's, and
 * a resultatansvarig attesting a cost centre has no business reading them. The
 * page gate (`canBookkeep`) is what makes this the one screen that may.
 *
 * `select-all` on each number, so one click takes the whole thing rather than
 * the word the cursor landed in. These get typed into a bank, and a clearing
 * number half-copied is a payment to somebody else.
 */
function PayoutCard({
  name,
  payout,
}: {
  name: string;
  payout: { clearing: string; account: string };
}) {
  const t = useTranslations("book");
  const missing = !payout.clearing || !payout.account;

  return (
    <Card>
      <CardHeader title={t("payoutTitle")} subtitle={t("payoutHint")} />
      <CardBody>
        {missing ? (
          // Not a blank line. An utlägg cannot be submitted without payout
          // details, so this is somebody who cleared their profile after it was
          // attested, and the bookkeeper would otherwise sit waiting for digits
          // that are not coming.
          <Notice>{t("payoutMissing", { name })}</Notice>
        ) : (
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 sm:grid-cols-3">
            <PayoutField label={t("payoutRecipient")} value={name} />
            <PayoutField label={t("payoutClearing")} value={payout.clearing} figures />
            <PayoutField label={t("payoutAccount")} value={payout.account} figures />
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

/** One label over one value. `figures` is for the two that are numbers to be
 *  read off and copied, rather than a name to be read. */
function PayoutField({
  label,
  value,
  figures,
}: {
  label: string;
  value: string;
  figures?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 truncate text-sm font-medium",
          figures && "select-all tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
