"use client";

// The read-only halves of the expense detail page: everything that renders what
// the expense *is*. The interactive parts (actions panel, transaction picker)
// live with the state they need, in detail-client.tsx.
import { useTranslations } from "next-intl";
import { namedStops } from "@/lib/mileage/claim";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PaymentTag } from "@/components/ui/payment-tag";
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
  const { date } = useFormat();
  return (
    <Card>
      {/* The utlägg's own actions ride this header: it is the card that *is* the
          utlägg, and what you can do to a thing belongs to the thing rather
          than to the page around it. They were in the page header until that
          became identity only. See components/page-shell.tsx. */}
      <CardHeader title={t("details")} action={action} />
      {/* Explicit minmax(0,…) single column below sm: the implicit `auto` track
          would floor at its widest item's max-content width, and the allocation
          rows below hold names long enough to take the whole card past the edge
          of a phone. */}
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 sm:grid-cols-2">
        {/* A milersättning has no purchase date. What it has is the day it
            was driven, which is what the field holds and what the filing
            deadline runs from. Calling it "Kvittodatum" here would name a
            document the claim does not have, the same way it would on the
            cover page. */}
        <Detail
          label={expense.paymentType === "MILEAGE" ? t("journeyDate") : t("purchaseDate")}
          value={date(expense.purchaseDate)}
        />
        <Detail label={t("amount")} value={<Amount value={expense.grossAmount} size="md" signed />} />
        {expense.mileage && <JourneyDetail journey={expense.mileage} />}
        <div className="min-w-0 sm:col-span-2">
          <p className="mb-1.5 text-[13px] text-muted">{t("distribution")}</p>
          <div className="space-y-1.5">
            {expense.allocations.map((a) => (
              <div key={a.id} className="rounded-lg bg-surface px-3 py-2 text-sm">
                {/* Two lines on a phone, one from sm.
                    All three of these (the cost centre, the amount, the
                    approver) are things you read, and on 329px of card they
                    were three truncating boxes fighting for it: the name came
                    out at about 110px, which for a Swedish compound is the
                    first syllable and an ellipsis. Given a line of its own it
                    simply fits. The second line then has room for the two
                    short things, one at each end.
                    The amount is still the one that must never be cut. */}
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0 truncate sm:shrink">
                    <span className="font-medium">{a.costCenterCode}</span>
                    <span className="ml-1.5 text-muted">{a.costCenterName}</span>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-3 sm:shrink sm:justify-end sm:text-right">
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
          <PaymentTag type={expense.paymentType} />
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * The journey on the detail page.
 *
 * The same reading the panel beside it is showing on the typeset
 * utläggsräkning, said again in the page's own language, because the panel can be folded away, and
 * an attester deciding whether to approve should not have to open a PDF to see
 * what they are approving.
 *
 * The subtraction is set out rather than only its answer: two odometer readings
 * and the distance between them is a figure a reader can check, which is the
 * whole reason the readings are what gets recorded.
 */
function JourneyDetail({ journey }: { journey: NonNullable<Expense["mileage"]> }) {
  const t = useTranslations("mileage");
  const nf = (min: number, max: number) =>
    new Intl.NumberFormat("sv-SE", { minimumFractionDigits: min, maximumFractionDigits: max });
  const reading = (km: number | null) => (km == null ? "–" : nf(1, 1).format(km));
  // Only the stops that name a place. A draft saved with a blank row in the
  // middle would otherwise draw an arrow pointing at nothing.
  const stops = namedStops(journey.stops);

  return (
    <div className="min-w-0 space-y-3 sm:col-span-2">
      {/* Where it went, above the readings, because that is the order the
          question is asked in: an attester wants to know what journey this was
          before they want to know how long it was. A draft that has not said
          yet reads as a dash rather than an empty row.

          Every stop, not just the ends. A route through the wholesaler and the
          Systembolaget is what makes a longer distance make sense, and showing
          only where it began and ended would invite the attester to query a
          reading that is perfectly correct. Wrapping, since four stops do not
          fit one line on a phone. */}
      <div>
        <p className="mb-1.5 text-[13px] text-muted">{t("route.label")}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-surface px-3 py-2 text-sm">
          {stops.length === 0 ? (
            "–"
          ) : (
            stops.map((stop, i) => (
              <span key={i} className="flex items-center gap-x-1.5">
                {i > 0 && (
                  <span aria-hidden className="text-muted">
                    →
                  </span>
                )}
                {stop}
              </span>
            ))
          )}
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-[13px] text-muted">{t("odometer.label")}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-sm">
          <span className="tabular-nums">
            {reading(journey.odometerStart)}
            <span aria-hidden className="mx-1.5 text-muted">→</span>
            {reading(journey.odometerEnd)}
            <span className="ml-1.5 text-muted">km</span>
          </span>
          <span className="flex items-center gap-3 tabular-nums">
            <span className="font-medium">
              {journey.km == null ? "–" : t("km", { km: nf(0, 1).format(journey.km) })}
            </span>
            {journey.orePerKm != null && (
              <span className="text-xs text-muted">
                {t("rates.perKm", { amount: nf(2, 2).format(journey.orePerKm / 100) })}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
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
        subtitle={`${date(verification.date)} – ${verification.description}`}
        action={
          canEdit ? (
            <ButtonLink href={`/expenses/${expenseId}/book`} variant="secondary" size="sm">
              {t("amend")}
            </ButtonLink>
          ) : undefined
        }
      />
      {/* Three columns from sm, two below it.
          The table was `min-w-[460px]` in a sideways scroller, which on 361px of
          phone meant dragging a voucher about to read it. What gives is a column
          that was never carrying its width: a line of a double entry is a debit
          *or* a credit, never both, so on a narrow screen the two become one
          amount with the side written above it. Nothing is dropped. The same
          figure, and the word that says which column it would have been in.

          Hidden with `hidden`/`sm:table-cell` on both the header and the body,
          so every row shows the same set and the columns stay in step. Safe here
          precisely because there is no `<colgroup>`: this table is auto-layout
          and sizes itself from the cells that are actually there. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-0 text-sm sm:min-w-[460px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 pl-inset pr-3 font-medium">{t("account")}</th>
              <th className="py-2 pl-3 pr-inset text-right font-medium sm:hidden">
                {t("amount")}
              </th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">{t("debit")}</th>
              <th className="hidden py-2 pl-3 pr-inset text-right font-medium sm:table-cell">
                {t("credit")}
              </th>
            </tr>
          </thead>
          <tbody>
            {verification.lines.map((l) => (
              <tr key={l.id} className="border-t border-border align-top">
                {/* `break-words`: an account name is one unbroken Swedish
                    compound, and in a 240px column there is nothing to wrap at. */}
                <td className="break-words py-2 pl-inset pr-3">
                  <span className="font-medium tabular-nums">{l.account}</span>{" "}
                  <span className="text-muted">{l.accountName}</span>
                  {l.costCenterCode && <span className="text-muted"> – {l.costCenterCode}</span>}
                  {l.description && (
                    <span className="block text-xs text-muted">{l.description}</span>
                  )}
                </td>
                <td className="whitespace-nowrap py-2 pl-3 pr-inset text-right sm:hidden">
                  <span className="block text-[11px] text-muted">
                    {l.debit ? t("debit") : t("credit")}
                  </span>
                  <span className="tabular-nums">
                    <Amount value={l.debit || l.credit} />
                  </span>
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                  {l.debit ? <Amount value={l.debit} /> : ""}
                </td>
                <td className="hidden py-2 pl-3 pr-inset text-right tabular-nums sm:table-cell">
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

  // Two event types carry data rather than prose in `comment`. The fields an
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
