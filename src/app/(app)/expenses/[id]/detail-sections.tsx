"use client";

// The read-only halves of the expense detail page: everything that renders what
// the expense *is*. The interactive parts (actions panel, transaction picker)
// live with the state they need, in detail-client.tsx.
import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tag } from "@/components/ui/status-pill";
import { IconCheck } from "@/components/ui/icons";
import { Amount } from "@/components/ui/amount";
import type { Expense } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";

// A node rather than a string: the amount is an <Amount>, which sets the kronor
// and the öre at different weights and cannot be a string.
function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted">{label}</p>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

export function DetailsCard({ expense, action }: { expense: Expense; action?: React.ReactNode }) {
  const t = useTranslations("expenses.detail");
  const tPayment = useTranslations("common.payment");
  const { date } = useFormat();
  return (
    <Card>
      {/* The utlägg's own actions ride this header: it is the card that *is* the
          utlägg, and what you can do to a thing belongs to the thing rather
          than to the page around it. They were in the page header until that
          became identity only — see components/page-shell.tsx. */}
      <CardHeader title={t("details")} action={action} />
      {/* Explicit minmax(0,…) single column below sm: the implicit `auto` track
          would floor at its widest item's max-content width, and the allocation
          rows below hold names long enough to take the whole card past the edge
          of a phone. */}
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 sm:grid-cols-2">
        <Detail label={t("purchaseDate")} value={date(expense.purchaseDate)} />
        <Detail label={t("amount")} value={<Amount value={expense.grossAmount} size="md" signed />} />
        <div className="min-w-0 sm:col-span-2">
          <p className="mb-1.5 text-[13px] text-muted">{t("distribution")}</p>
          <div className="space-y-1.5">
            {expense.allocations.map((a) => (
              <div key={a.id} className="rounded-lg bg-surface px-3 py-2 text-sm">
                {/* The amount is the only thing here that must never be cut;
                    the cost-centre name gives way first and the resultUnit or
                    approver second. Every one of these is a single long
                    unbroken word in Swedish, so without somewhere to truncate the
                    two halves met with no space between them on a phone and the
                    row pushed the whole page sideways. */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 shrink truncate">
                    <span className="font-medium">{a.costCenterCode}</span>
                    <span className="ml-1.5 text-muted">{a.costCenterName}</span>
                  </div>
                  <div className="flex min-w-0 shrink items-center gap-3 text-right">
                    <span className="shrink-0"><Amount value={a.amount} signed /></span>
                    {a.approvedById ? (
                      <span className="flex min-w-0 items-center gap-1 text-xs text-success">
                        <IconCheck className="size-3.5 shrink-0" />
                        <span className="truncate">{a.approvedByName}</span>
                      </span>
                    ) : (
                      <span className="truncate text-xs text-muted">
                        {a.resultUnit ?? t("awaitingApproval")}
                      </span>
                    )}
                  </div>
                </div>
                {a.comment && <p className="mt-1 text-xs italic text-muted">{a.comment}</p>}
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <p className="mb-1.5 text-[13px] text-muted">{t("paymentType")}</p>
          <Tag>{tPayment(`${expense.paymentType}.label`)}</Tag>
        </div>
      </CardBody>
    </Card>
  );
}

export function VerificationCard({
  verification,
  expenseId,
  canEdit,
}: {
  verification: NonNullable<Expense["verification"]>;
  expenseId: string;
  canEdit: boolean;
}) {
  const t = useTranslations("expenses.detail");
  const { date } = useFormat();
  return (
    <Card>
      <CardHeader
        title={t("verification")}
        subtitle={`${date(verification.date)} · ${verification.description}`}
        action={
          canEdit ? (
            <ButtonLink href={`/expenses/${expenseId}/book`} variant="secondary" size="sm">
              {t("amend")}
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 pl-inset pr-3 font-medium">{t("account")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("debit")}</th>
              <th className="py-2 pl-3 pr-inset text-right font-medium">{t("credit")}</th>
            </tr>
          </thead>
          <tbody>
            {verification.lines.map((l) => (
              <tr key={l.id} className="border-t border-border align-top">
                <td className="py-2 pl-inset pr-3">
                  <span className="font-medium tabular-nums">{l.account}</span>{" "}
                  <span className="text-muted">{l.accountName}</span>
                  {l.costCenterCode && <span className="text-muted"> · {l.costCenterCode}</span>}
                  {l.description && (
                    <span className="block text-xs text-muted">{l.description}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.debit ? <Amount value={l.debit} /> : ""}
                </td>
                <td className="py-2 pl-3 pr-inset text-right tabular-nums">
                  {l.credit ? <Amount value={l.credit} /> : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {verification.fortnoxLabel && (
        <div className="border-t border-border px-inset py-3 text-xs text-muted">
          {t("exportedToFortnox")}{" "}
          <span className="font-medium text-foreground">{verification.fortnoxLabel}</span>
        </div>
      )}
    </Card>
  );
}

export function TimelineCard({ revisions }: { revisions: Expense["revisions"] }) {
  const t = useTranslations("expenses.detail");
  // `action` is an ExpenseEventType, named here rather than in the data layer.
  const tEvent = useTranslations("expenses.event");
  const tField = useTranslations("expenses.field");
  const { dateTime } = useFormat();

  // Two event types carry data rather than prose in `comment` — the fields an
  // edit touched, and the voucher an export produced. Everything else wrote a
  // comment someone typed, which is shown as it was written.
  function comment(r: Expense["revisions"][number]): string | undefined {
    if (!r.comment) return undefined;
    if (r.action === "EDITED") {
      return t("editedFields", {
        fields: r.comment
          .split(",")
          .map((f) => (tField.has(f) ? tField(f) : f))
          .join(", "),
      });
    }
    if (r.action === "EXPORTED") return t("voucherComment", { label: r.comment });
    return r.comment;
  }
  return (
    <Card>
      <CardHeader title={t("history")} />
      <CardBody>
        <ol className="space-y-5">
          {revisions.map((r, i) => (
            <li key={r.id} className="flex gap-3.5">
              <div className="flex flex-col items-center">
                <span className="mt-0.5 size-2.5 rounded-full bg-brand" />
                {i < revisions.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
              </div>
              <div className="-mt-0.5 pb-1">
                <p className="text-sm font-medium">{tEvent(r.action)}</p>
                <p className="text-xs text-muted">
                  {r.actor} - {dateTime(r.date)}
                </p>
                {comment(r) && (
                  <p className="mt-1.5 rounded-lg bg-surface px-3 py-2 text-sm">{comment(r)}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
