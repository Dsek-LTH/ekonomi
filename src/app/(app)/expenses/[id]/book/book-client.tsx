"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { IconCheck, IconLock, IconPlus, IconX } from "@/components/ui/icons";
import { useRole } from "@/components/shell/role-context";
import { useMutation } from "@/components/shell/use-mutation";
import { canBookkeep } from "@/lib/domain/permissions";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { PageShell } from "@/components/page-shell";
import { Combobox } from "@/components/ui/combobox";
import { TableScroll } from "@/components/ui/table-scroll";
import type { AccountRecord, BookkeepingSettings } from "@/lib/domain/types";
import { Amount } from "@/components/ui/amount";
// The out-of-balance difference is set inside a sentence, so that one stays a
// string — everything else on this page is an Amount.
import { formatSEK } from "@/lib/ui/format";
import { oreToSEK, parseOre, sekToOre } from "@/lib/domain/money";
import { voucherBlocker } from "@/lib/domain/voucher";
import { expenseLabel } from "@/lib/domain/reference";
import { DateInput, Field } from "@/components/ui/field";
import { cn, uid } from "@/lib/ui/utils";
import type { CostCenter, Expense } from "@/lib/domain/types";
import { useProgressRouter } from "@/components/shell/route-progress";

interface Row {
  id: string;
  account: string;
  description: string;
  costCenterCode: string;
  debit: string;
  credit: string;
}

// The amount columns hold text, not type="number": that drops a lone leading
// "-" from .value (a return is booked with the sign flipped) and rejects
// "1 234,50". So what may be typed is the shape parseSEK reads instead —
// digits, spaces as thousand separators, one comma or dot, optional minus.
// Partial input has to pass too, since this runs on every keystroke: "-", "12,"
// and "" are all on the way to a number.
const AMOUNT_PATTERN = /^-?[\d ]*(?:[.,]\d*)?$/;

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
      debit: a.amount.toFixed(2),
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
  const tAlloc = useTranslations("allocation");
  const { user } = useRole();
  const { busy: submitting, mutate } = useMutation();

  const accountName = (number: string) =>
    accounts.find((a) => a.number === number.trim())?.name ?? "";
  const accountExists = (n: string) => accounts.some((a) => a.number === n.trim());

  // APPROVED → create a voucher; BOOKED → amend it (before export).
  const mode: "create" | "edit" | null =
    expense?.status === "APPROVED" ? "create" : expense?.status === "BOOKED" ? "edit" : null;

  // The voucher text always starts with a fixed, non-editable prefix: the
  // submitter's name for a card purchase, "PU <name>" for a reimbursement. The
  // user can only append free text after it.
  const textPrefix = expense
    ? expense.paymentType === "CARD" ? expense.submitterName : `PU ${expense.submitterName}`
    : "";

  const [date, setDate] = useState(
    () => expense?.verification?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [textSuffix, setTextSuffix] = useState(() => {
    const full = expense?.verification?.description ?? expense?.title ?? "";
    return full.startsWith(textPrefix) ? full.slice(textPrefix.length).trim() : full;
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
  const voucherLines = [
    {
      account: paymentAccount,
      accountName: accountName(paymentAccount),
      description: paymentText,
      costCenterCode: null as string | null,
      debit: 0,
      credit: sekToOre(paymentCredit),
    },
    ...rows.map((r) => ({
      account: r.account.trim(),
      accountName: accountName(r.account),
      description: r.description || null,
      costCenterCode: r.costCenterCode || null,
      debit: parseOre(r.debit),
      credit: parseOre(r.credit),
    })),
  ];

  const totalDebit = oreToSEK(voucherLines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = oreToSEK(voucherLines.reduce((s, l) => s + l.credit, 0));
  const diff = totalDebit - totalCredit;
  // The same rule the route applies (lib/domain/voucher.ts), on the same rows,
  // in the same unit — so "balanced" here and "balanced" there cannot disagree.
  const balanced = voucherBlocker(voucherLines) === null;
  const costCenterExists = (code: string) => costCenters.some((c) => c.code === code.trim());
  const allValidAccounts = rows.every((r) => accountExists(r.account));
  const allValidCostCenters = rows.every(
    (r) => !r.costCenterCode.trim() || costCenterExists(r.costCenterCode),
  );
  // A payment account that isn't in the chart is a settings problem, not
  // something to book around — see the banner below.
  const paymentAccountKnown = accountExists(paymentAccount);
  const canSubmit =
    balanced && allValidAccounts && allValidCostCenters && paymentAccountKnown && !submitting;

  function patch(id: string, change: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }
  // Anything that isn't on its way to an amount is simply not taken — the field
  // keeps what it had, so a stray letter leaves no trace to delete.
  function patchAmount(id: string, field: "debit" | "credit", value: string) {
    if (!AMOUNT_PATTERN.test(value)) return;
    patch(id, { [field]: value });
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      { id: uid(), account: "", description: "", costCenterCode: "", debit: "", credit: "" },
    ]);
  }
  function removeRow(id: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

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

  const headerCell = "px-2 py-2.5 text-center font-medium";
  const cellInput =
    "block h-10 w-full bg-transparent px-2 text-center text-sm placeholder:text-muted/50 focus-inset";
  const amountInput = cn(cellInput, "tabular-nums");
  // Tight padding: these two columns are only as wide as a code needs, so the
  // chevron and padding would otherwise be most of the box.
  const cellCombo = "h-10 gap-1 bg-transparent px-1.5 focus-inset";
  // The lists arrive already scoped to what's offerable — active, plus anything
  // this voucher already points at (see getActiveAccounts/getActiveCostCenters),
  // so there's nothing left to filter here.
  // `short` collapses the trigger to the bare code once picked, which is what
  // lets these columns stay narrow; search still matches the full
  // "1931 · Företagskonto", and for accounts the name reappears in its own column.
  const accountOptions = accounts.map((a) => ({
    value: a.number,
    label: `${a.number} · ${a.name}`,
    short: a.number,
  }));
  const ccOptions = costCenters.map((c) => ({
    value: c.code,
    label: `${c.code} · ${c.name}`,
    short: c.code,
  }));

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
      <ReceiptPanelSource
        receiptId={expense.receiptId ?? null}
        mimeType={expense.receiptMimeType ?? "image/jpeg"}
        filename={`${tReceipt("alt")} · ${expense.title}`}
        // Said in the panel, not in the page. A voucher with no underlag is
        // something the bookkeeper has to know about, and it belongs where the
        // underlag would have been — so the voucher table sits in the same
        // place whether there's a receipt beside it or not.
        emptyTitle={t("noReceiptTitle")}
        emptyDescription={t("noReceiptDescription")}
      />

      <div className="grid gap-6">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <Field label={t("voucherDate")}>
            <DateInput size="sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t("voucherText")}>
            {/* Prefix and input are one field, so the ring goes round the pair
                — focus-ring-within draws it on the box and suppresses the
                input's own (see globals.css). */}
            <div className="focus-ring-within flex h-9 w-full items-center rounded-lg border border-border bg-background px-2.5 text-sm">
              {/* The prefix is a person's name, so its width is out of our
                  hands. Nowrap-and-never-shrink made the box wider than the
                  card body on a long name; it truncates instead, and the
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
        {/* TableScroll, not a bare overflow-x-auto, for the overscroll
            containment: a sideways swipe on the widest column here used to
            chain to the browser's back gesture. */}
        <TableScroll minWidth="min-w-[600px]">
          {/* table-fixed: the header percentages below decide the columns, so a
              cell's content can never push the table wider than its container.
              With auto layout the bare <input>s each claimed ~180px of
              intrinsic width and forced a horizontal scrollbar under ~1400px.
              The percentages must add up to 100, and each has to leave room for
              its own header: "Kostnadsställe" is one unbreakable word ~95px
              wide, and at the old 13% of 520px it simply ran into the next
              column.
              min-w sits below the ~700px the table gets on the narrowest
              desktop that shows the receipt beside it, so the wrapper only ever
              scrolls on a phone — where squeezing seven columns in is worse
              than scrolling. */}
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="divide-x divide-border border-b border-border bg-surface/40 text-xs text-muted">
                <th className={cn(headerCell, "w-[10%]")}>{t("colAccount")}</th>
                <th className={cn(headerCell, "w-[22%]")}>{t("colAccountName")}</th>
                <th className={cn(headerCell, "w-[18%]")}>{t("colCostCenter")}</th>
                <th className={cn(headerCell, "w-[15%]")}>{t("colDescription")}</th>
                <th className={cn(headerCell, "w-[15%]")}>{t("colDebit")}</th>
                <th className={cn(headerCell, "w-[15%]")}>{t("colCredit")}</th>
                <th className="w-[5%]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* The payment row. Which account the money comes from follows
                  from the payment type, and the amount is the expense's — so
                  there is nothing here to choose, and no ✕ to remove it with.
                  Not part of `rows`; it's assembled straight into the payload. */}
              <tr className="divide-x divide-border bg-surface/40">
                <td className="px-2 py-3 text-center align-middle font-medium tabular-nums">
                  {paymentAccount || "—"}
                </td>
                <td className="px-2 align-middle">
                  <div
                    className="truncate text-center text-sm text-muted"
                    title={accountName(paymentAccount) || undefined}
                  >
                    {accountName(paymentAccount) || "—"}
                  </div>
                </td>
                <td className="px-2 text-center align-middle text-sm text-muted">—</td>
                <td className="px-2 align-middle text-center text-sm text-muted">
                  {paymentText}
                </td>
                <td className="px-2 text-center align-middle text-sm text-muted tabular-nums">—</td>
                <td className="px-2 text-center align-middle text-sm font-medium tabular-nums">
                  {paymentCredit.toFixed(2).replace(".", ",")}
                </td>
                <td className="text-center align-middle">
                  <span
                    className="flex items-center justify-center px-2 text-muted/40"
                    title={t("lockedRowHint")}
                    aria-label={t("lockedRow")}
                  >
                    <IconLock className="size-4" />
                  </span>
                </td>
              </tr>
              {rows.map((r) => {
                return (
                  <tr key={r.id} className="divide-x divide-border">
                    <td className="p-0 align-middle">
                      <Combobox
                        options={accountOptions}
                        value={r.account}
                        onChange={(v) => patch(r.id, { account: v })}
                        placeholder={t("accountPlaceholder")}
                        searchPlaceholder={t("accountSearch")}
                        align="center"
                        buttonClassName={cellCombo}
                        aria-label={t("colAccount")}
                      />
                    </td>
                    {/* Derived from the picked account, so read-only — it's the
                        name the trigger no longer shows. */}
                    <td className="px-2 align-middle">
                      {/* truncate needs a block box — overflow on a table-cell
                          isn't honoured consistently across browsers. */}
                      <div
                        className="truncate text-center text-sm text-muted"
                        title={accountName(r.account) || undefined}
                      >
                        {accountName(r.account) || "—"}
                      </div>
                    </td>
                    <td className="p-0 align-middle">
                      <Combobox
                        options={ccOptions}
                        value={r.costCenterCode}
                        onChange={(v) => patch(r.id, { costCenterCode: v })}
                        placeholder="—"
                        searchPlaceholder={tAlloc("search")}
                        allowClear
                        align="center"
                        buttonClassName={cellCombo}
                        aria-label={t("colCostCenter")}
                      />
                    </td>
                    <td className="p-0 align-middle">
                      {/* size=1 kills the ~180px default intrinsic width an
                          <input> would otherwise contribute to the column. */}
                      <input
                        size={1}
                        value={r.description}
                        onChange={(e) => patch(r.id, { description: e.target.value })}
                        placeholder={t("textPlaceholder")}
                        className={cellInput}
                      />
                    </td>
                    <td className="p-0 align-middle">
                      <input
                        size={1}
                        inputMode="decimal"
                        value={r.debit}
                        onChange={(e) => patchAmount(r.id, "debit", e.target.value)}
                        className={amountInput}
                        placeholder="0,00"
                      />
                    </td>
                    <td className="p-0 align-middle">
                      <input
                        size={1}
                        inputMode="decimal"
                        value={r.credit}
                        onChange={(e) => patchAmount(r.id, "credit", e.target.value)}
                        className={amountInput}
                        placeholder="0,00"
                      />
                    </td>
                    <td className="text-center align-middle">
                      <IconButton tone="danger" size="sm" label={tAlloc("removeRow")} onClick={() => removeRow(r.id)}>
                        <IconX className="size-4" />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td colSpan={4} className="px-3 py-3">
                  <button
                    onClick={addRow}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                  >
                    <IconPlus className="size-4" />
                    {t("addRow")}
                  </button>
                </td>
                <td className="px-2 py-3 text-center"><Amount value={totalDebit} size="md" /></td>
                <td className="px-2 py-3 text-center"><Amount value={totalCredit} size="md" /></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </TableScroll>

        {!paymentAccountKnown && (
          <p className="border-t border-border px-6 py-3 text-sm text-danger">
            {t("unknownPaymentAccount", { account: paymentAccount || t("notSet") })}
          </p>
        )}

        <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
          {balanced ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-sm font-medium text-success">
              <IconCheck className="size-4" />
              {t("balanced")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-sm font-medium text-danger">
              {t("difference", { amount: formatSEK(diff) })}
            </span>
          )}

          <div className="flex items-center gap-2.5">
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
