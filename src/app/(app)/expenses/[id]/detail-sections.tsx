"use client";

// The read-only parts of the expense detail page: everything that renders what
// the expense *is*. The interactive parts (actions, transaction picker) live
// with the state they need, in detail-client.tsx.
//
// The page is laid out like the document it stands for. An utlägg is an
// invoice the section owes or has paid, so the card reads like one: the total
// at the top, the facts in a ruled strip under it, the cost distribution as
// line items with the sum ruled off, the voucher, and the history in small
// print at the foot. One card rather than a stack of them: stacked cards made
// every part look equally important and put a band of page between facts that
// belong together.
import { useTranslations } from "next-intl";
import { namedStops } from "@/lib/mileage/claim";
import { ButtonLink } from "@/components/ui/button";
import { PaymentTag } from "@/components/ui/payment-tag";
import { StatusPill } from "@/components/ui/status-pill";
import { Amount } from "@/components/ui/amount";
import type { Expense } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { formatNumber } from "@/lib/ui/format";
import { bookingTrail } from "@/lib/domain/review";
import { PersonName } from "@/components/ui/avatar";
import {
  AllocationTable,
  AttestedBy,
  InspectorSection,
  LABEL,
  StripCell,
  VoucherTable,
} from "@/components/record-card";

/**
 * The head of the card: where the utlägg stands, and what you can do about it.
 *
 * The page header above stays identity only (title, reference, submitter). The
 * status opens the card on the left. The actions take the top right corner,
 * where the eye goes for what to do next and where they sit on every other
 * card in the app, and they belong to the card because what you can do to a
 * thing belongs to the thing. See components/page-shell.tsx.
 *
 * On a phone the actions wrap under the status and take the full row, which is
 * what ExpenseActions is built to do below sm.
 */
export function ExpenseSummary({ expense, actions }: { expense: Expense; actions: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-inset py-4">
      <StatusPill status={expense.status} className="mt-1.5" />
      {actions}
    </div>
  );
}

/**
 * The three facts every reader comes for, in ruled columns under the status:
 * the amount, the date, and how it was paid.
 *
 * The rules are the grid's gap showing the border colour through, so they run
 * between cells in both directions however the row wraps. Three columns from
 * sm. On a phone three would leave each about 90px, too little for an amount
 * and a payment tag, so the amount takes the first row on its own and the
 * other two share the second.
 */
export function FactStrip({ expense }: { expense: Expense }) {
  const t = useTranslations("expenses.detail");
  const { date } = useFormat();
  return (
    <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
      <StripCell label={t("amount")} className="col-span-2 sm:col-span-1">
        <Amount value={expense.grossAmount} size="md" signed />
      </StripCell>
      {/* A milersättning has no purchase date. What it has is the day it was
          driven, which is what the field holds and what the filing deadline
          runs from. Calling it "Kvittodatum" would name a document it does not
          have. */}
      <StripCell label={expense.paymentType === "MILEAGE" ? t("journeyDate") : t("purchaseDate")}>
        {date(expense.purchaseDate)}
      </StripCell>
      <StripCell label={t("paymentType")}>
        <PaymentTag type={expense.paymentType} />
      </StripCell>
    </div>
  );
}

/**
 * Everything else about the purchase, one label and value per line: the
 * journey a milersättning was for, and a dispens from the filing deadline.
 * Only the ones this utlägg has. The bank row of a card purchase is a section
 * of its own; see BankSection in detail-client.tsx.
 */
export function NotesSection({ expense }: { expense: Expense }) {
  const t = useTranslations("expenses.detail");
  const { date } = useFormat();
  if (!expense.mileage && !expense.deadlineWaiver) return null;
  return (
    <InspectorSection>
      <dl className="space-y-2 text-sm">
        {expense.mileage && <JourneyFacts journey={expense.mileage} />}
        {expense.deadlineWaiver && (
          <Fact label={t("deadlineWaiver")}>
            {t("deadlineWaiverGranted", {
              name: expense.deadlineWaiver.by,
              date: date(expense.deadlineWaiver.at),
            })}
            <span className="mt-0.5 block text-xs italic text-muted">{expense.deadlineWaiver.reason}</span>
          </Fact>
        )}
      </dl>
    </InspectorSection>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-y-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-x-4">
      <dt className={cn(LABEL, "sm:pt-0.5")}>{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * The journey, said again in the page's own language beside the typeset
 * utläggsräkning, because the panel can be folded away, and an attester
 * deciding whether to approve should not have to open a PDF to see what they
 * are approving.
 *
 * The subtraction is set out rather than only its answer: two odometer readings
 * and the distance between them is a figure a reader can check, which is the
 * whole reason the readings are what gets recorded.
 */
function JourneyFacts({ journey }: { journey: NonNullable<Expense["mileage"]> }) {
  const t = useTranslations("mileage");
  const reading = (km: number | null) => (km == null ? "-" : formatNumber(km, 1, 1));
  // Only the stops that name a place. A draft saved with a blank row in the
  // middle would otherwise draw an arrow pointing at nothing.
  const stops = namedStops(journey.stops);

  return (
    <>
      {/* Every stop, not just the ends: a route through the wholesaler is what
          makes a longer distance make sense. */}
      <Fact label={t("route.label")}>
        {stops.length === 0 ? (
          "-"
        ) : (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {stops.map((stop, i) => (
              <span key={i} className="flex items-center gap-x-1.5">
                {i > 0 && (
                  <span aria-hidden className="text-muted">
                    →
                  </span>
                )}
                {stop}
              </span>
            ))}
          </span>
        )}
      </Fact>
      <Fact label={t("odometer.label")}>
        <span className="tabular-nums">
          {reading(journey.odometerStart)}
          <span aria-hidden className="mx-1.5 text-muted">→</span>
          {reading(journey.odometerEnd)}
          <span className="ml-1.5 text-muted">km</span>
        </span>
      </Fact>
      <Fact label={t("distance")}>
        <span className="tabular-nums">
          {journey.km == null ? "-" : t("km", { km: formatNumber(journey.km, 0, 1) })}
          {journey.orePerKm != null && (
            <span className="ml-3 text-xs text-muted">
              {t("rates.perKm", { amount: formatNumber(journey.orePerKm / 100, 2, 2) })}
            </span>
          )}
        </span>
      </Fact>
    </>
  );
}

/** The cost distribution, as AllocationTable draws one. */
export function AllocationSection({ allocations }: { allocations: Expense["allocations"] }) {
  const t = useTranslations("expenses.detail");
  return (
    <AllocationTable
      caption={t("distribution")}
      lines={allocations.map((a) => ({
        ...a,
        attest: a.approvedById ? (
          <AttestedBy name={a.approvedByName} />
        ) : (
          <span className="text-muted">{a.resultUnit ?? t("awaitingApproval")}</span>
        ),
      }))}
    />
  );
}

/**
 * The kontering: the voucher the utlägg was booked as.
 *
 * Laid out the way a ledger prints one, a column per thing: account number,
 * account name, cost centre, debit, credit. They used to share one cell
 * ("5460 Förbrukningsinventarier - INFU", with the line's description under
 * it), which made every row a sentence to read rather than a row to scan.
 *
 * A line's own description is shown only where it says something the voucher's
 * does not. Booked from an utlägg, almost every line repeats the voucher text
 * word for word, and printing it under each row was most of the clutter.
 */
/**
 * Who konterade the utlägg, and who amended the voucher since, from the
 * history. Which events count is bookingTrail's rule, the same one the
 * two-person rule counts by.
 */
function bookingPeople(revisions: Expense["revisions"]) {
  const trail = bookingTrail(revisions.map((r) => ({ ...r, type: r.action })));
  if (!trail) return null;
  const booker = trail.booked.actor;
  const amenders = [...new Set(trail.amended.map((r) => r.actor).filter((a) => a !== booker))];
  return { booker, at: trail.booked.date, amenders };
}

export function VerificationSection({
  verification,
  expenseId,
  canEdit,
  revisions,
}: {
  verification: NonNullable<Expense["verification"]>;
  expenseId: string;
  canEdit: boolean;
  revisions: Expense["revisions"];
}) {
  const t = useTranslations("expenses.detail");
  const { date, list } = useFormat();
  const people = bookingPeople(revisions);
  const ownText = (d: string | undefined) =>
    d && d.trim() !== verification.description.trim() ? d : undefined;

  return (
    <InspectorSection
      title={t("verification")}
      aside={
        verification.fortnoxLabel && (
          // The Fortnox number beside the title, where a voucher's number sits
          // on paper. What it is a number *of* is on the element for a pointer.
          <span
            title={`${t("exportedToFortnox")} ${verification.fortnoxLabel}`}
            className="font-medium tabular-nums"
          >
            {verification.fortnoxLabel}
          </span>
        )
      }
      flush
      endsInTable={!people}
      action={
        canEdit ? (
          <ButtonLink href={`/expenses/${expenseId}/book`} variant="secondary" size="sm">
            {t("amend")}
          </ButtonLink>
        ) : undefined
      }
    >
      <p className="-mt-1 mb-3 truncate px-inset text-xs text-muted">
        <span className="tabular-nums">{date(verification.date)}</span> - {verification.description}
      </p>
      <VoucherTable
        lines={verification.lines.map((l) => ({
          key: l.id,
          account: l.account,
          accountName: l.accountName,
          costCenter: l.costCenterCode,
          project: l.project,
          note: ownText(l.description),
          debit: l.debit,
          credit: l.credit,
        }))}
      />
      {/* Who konterade it, signed at the foot the way a paper voucher is. The
          person who bokför it next is not to be the same one, and before this
          it was only to be found in the history. */}
      {people && (
        <dl className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border px-inset pt-3 text-xs">
          <div className="flex items-baseline gap-2">
            <dt className={LABEL}>{t("bookedBy")}</dt>
            <dd>
              <span className="font-medium">{people.booker}</span>
              <span className="text-muted">, <span className="tabular-nums">{date(people.at)}</span></span>
            </dd>
          </div>
          {people.amenders.length > 0 && (
            <div className="flex items-baseline gap-2">
              <dt className={LABEL}>{t("amendedBy")}</dt>
              <dd className="font-medium">{list(people.amenders)}</dd>
            </div>
          )}
        </dl>
      )}
    </InspectorSection>
  );
}

/**
 * The history, as the small print at the foot of the document: one line per
 * event, in the order they were recorded, with a typed comment under its line.
 *
 * No timeline graphics. Who attested which line is already in the attest
 * column above, so the history only has to be complete, not loud. The two
 * events that decide something keep their colour on the word itself.
 */
const EVENT_TONE: Record<string, string> = {
  COST_CENTER_APPROVED: "text-blue",
  APPROVED: "text-blue",
  CHANGES_REQUESTED: "text-danger",
};

export function TimelineSection({ revisions }: { revisions: Expense["revisions"] }) {
  const t = useTranslations("expenses.detail");
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
    // Tinted one step down from the card and last in it, so it takes the card's
    // bottom corners: a square band would stick out past the rounded edge.
    <section className="rounded-b-panel border-t border-border bg-canvas px-inset py-4">
      <h2 className={cn(LABEL, "mb-2")}>{t("history")}</h2>
      <ol className="space-y-1.5 text-xs">
        {revisions.map((r) => (
          <li key={r.id} className="grid grid-cols-[minmax(0,1fr)] gap-x-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <span className="tabular-nums text-muted">{dateTime(r.date)}</span>
            <span className="min-w-0">
              <span className={cn("font-medium", EVENT_TONE[r.action])}>{tEvent(r.action)}</span>
              <span className="text-muted">
                {" - "}
                <PersonName userId={r.actorId} name={r.actor} />
              </span>
              {r.recipients && r.recipients.length > 0 && (
                <span className="mt-0.5 block text-muted">
                  {t("reminderTo", { names: r.recipients.join(", ") })}
                </span>
              )}
              {comment(r) && <span className="mt-0.5 block text-muted">{comment(r)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
