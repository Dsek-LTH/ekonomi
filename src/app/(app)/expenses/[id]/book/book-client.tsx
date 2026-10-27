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
import { DateInput, Field } from "@/components/ui/field";
import { uid } from "@/lib/ui/utils";
import { useSelectOnce } from "@/lib/ui/use-select-once";
import type { CostCenter, Expense } from "@/lib/domain/types";
import { useReturnTo } from "@/components/shell/route-history";
import { withCostCenterTag } from "@/lib/domain/cost-center-tag";
import { useBookingPresence } from "./use-booking-presence";
import { OthersBookingNotice, UpdatedElsewhere } from "./presence-notices";

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
// the locked credit row in the table below. Null when the setting has not been
// chosen, and then nothing can be konterat.
function paymentAccountFor(expense: Expense, settings: BookkeepingSettings): string | null {
  return expense.paymentType === "CARD" ? settings.bankAccount : settings.memberDebtAccount;
}

// The payment row's two sides, in kronor. An ordinary utlägg credits the
// payment account with the gross. A return (negative gross, see
// lib/domain/matching.ts) is the same row the other way round: the money comes
// back in, so it is a debit of the magnitude. A voucher holds no negative
// amounts. See voucherBlocker.
function paymentSides(gross: number): { debit: number; credit: number } {
  return gross < 0 ? { debit: -gross, credit: 0 } : { debit: 0, credit: gross };
}

// Suggest the debit side from the expense's cost allocations. The credit side
// is never suggested. It is fixed. VAT is no longer stored on the expense, so
// split it out manually here if needed. A local cost centre's code starts out
// in the row text, as the editor writes it when one is picked. See
// lib/domain/cost-center-tag.
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

// Existing voucher → editable rows (when amending a booked verification). The
// payment row is dropped: it isn't editable, and it gets re-added on save. That
// also normalises any voucher booked before the row was locked. Which side it
// sits on depends on whether the expense is a return.
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
  const { user } = useRole();
  const { busy: submitting, mutate } = useMutation();
  const confirm = useConfirm();
  const { list } = useFormat();
  // The voucher date opens focused and full. See the field below.
  const selectOnce = useSelectOnce();
  // `expense` is still nullable here. The not-found case is narrowed further
  // down, and expenseDocuments takes that; the alt text has to as well.
  const documents = expenseDocuments(
    expense,
    `${tReceipt("alt")} - ${expense?.title ?? ""}`,
    // The panel stacks the two into one scroll, so each is captioned.
    { cover: tReceipt("coverLabel"), underlag: tReceipt("underlagLabel") },
  );

  const accountName = (number: string) =>
    accounts.find((a) => a.number === number.trim())?.name ?? "";
  const accountExists = (n: string) => accounts.some((a) => a.number === n.trim());

  // APPROVED → create a voucher; BOOKED → amend it (before export).
  const mode: "create" | "edit" | null =
    expense?.status === "APPROVED" ? "create" : expense?.status === "BOOKED" ? "edit" : null;

  // Who else has this utlägg open, and whether somebody saved it while it was
  // open here. Only for a screen that can actually book: an empty state has
  // nothing to collide over. See use-booking-presence.ts.
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

  // Amending: the voucher's own date. Booking: the day of the purchase, which
  // is what the utlägg is about. Today was neither, and dated every voucher the
  // day the bookkeeper happened to open it.
  //
  // `||` rather than `??`: purchaseDate is "" when the utlägg has none (see
  // isoDate in lib/data/shared.ts), and an empty string has to fall through.
  const [date, setDate] = useState(
    () =>
      expense?.verification?.date.slice(0, 10) ||
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
  // `rows` holds every row but the payment one. That row is derived from the
  // expense and rendered separately, which is what makes it unremovable.
  const paymentAccountSetting = expense ? paymentAccountFor(expense, settings) : null;
  // The row still has to be drawn while the setting is unchosen. It is drawn
  // with no account, and the notice below says which setting is missing.
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
          expense.status === "EXPORTED"
            ? t("lockedDescription")
            : t("notBookableDescription")
        }
        action={<ButtonLink href={`/expenses/${expense.id}`}>{t("toExpense")}</ButtonLink>}
      />
    );
  }

  // The locked payment row is always the full gross. The other rows are what
  // have to be made to match it, never the other way round.
  const payment = paymentSides(expense.grossAmount);

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
      // No row text of its own. The account says what the row is, and the
      // voucher text's prefix says card or private ("PU" in front), so
      // "Sektionskort" or "Privat utlägg" on the row only repeated them.
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
  const allValidProjects = typedRows.every(
    (r) => !r.project?.trim() || projects.some((p) => p.number === r.project!.trim()),
  );
  // Intäktskonton the voucher already carries. The picker no longer offers
  // them, so these can only come from a voucher written before the rule. The
  // server refuses them too. See isRevenueAccount.
  const revenueAccounts = [
    ...new Set(typedRows.map((r) => r.account.trim()).filter(isRevenueAccount)),
  ];
  // A payment account that isn't in the chart is a settings problem, not
  // something to book around. See the banner below.
  const paymentAccountKnown = accountExists(paymentAccount);
  // Not on a version somebody else has already replaced. The server refuses
  // that too. This is so the button says so first.
  const canSubmit =
    !blocker &&
    allValidAccounts &&
    allValidCostCenters &&
    allValidProjects &&
    revenueAccounts.length === 0 &&
    paymentAccountKnown &&
    !submitting &&
    !presence.stale;

  async function save() {
    // Somebody else has it open. Not a lock: they may have opened it and gone
    // for coffee. But whoever saves second will have to start over, so the one
    // saving first should know that is what they are doing.
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
      },
      error: t("saveFailed"),
    });
    if (!saved) {
      // Possibly a 409 because somebody got there first. Asking at once turns
      // that toast into the reload dialog instead of leaving it at a toast.
      presence.resume();
      return;
    }
    // Back out of the form rather than pushing the utlägg in front of it:
    // the utlägg is the entry we came from, and pushing it made the first Back
    // press land in the booking form for an already-booked utlägg. `returnTo`
    // refreshes the utlägg once it is reached, which is what shows the voucher
    // that was just written.
    returnTo(returnHref);
  }

  // Anything bookable has been through attest, so it has a reference; the
  // fallback is only here so the page can't render a blank where a name goes.
  const label = expenseLabel(expense);

  return (
    <PageShell
      title={mode === "edit" ? t("editTitle", { id: label }) : t("createTitle", { id: label })}
      back={returnHref}
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
      {/* Never empty: only an attested utlägg is konterat, and it was
          submitted with its receipt (or, a milersättning, with the journey on
          its cover). */}
      <ReceiptPanelSource documents={documents} />

      <div className="grid gap-6">
        <div className="min-w-0 space-y-4">
          {presence.stale ? (
            <UpdatedElsewhere by={presence.stale.by} />
          ) : (
            <OthersBookingNotice others={presence.others} />
          )}
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
            <div className="focus-ring-within flex h-11 w-full items-center rounded-control border border-border bg-background px-2.5 text-sm sm:h-9">
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

      <Card>
        <CardHeader title={t("lines")} subtitle={t("linesHint")} />
        <VoucherEditor
          rows={rows}
          onChange={setRows}
          accounts={accounts}
          costCenters={costCenters}
          projects={projects}
          // The payment row. Which account the money comes from follows from
          // the payment type, and the amount is the expense's, so there is
          // nothing here to choose, and no ✕ to remove it with.
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
                ? t(expense.paymentType === "CARD" ? "bankAccountUnset" : "memberDebtAccountUnset")
                : t("unknownPaymentAccount", { account: paymentAccount })}
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
