"use client";

// The read-only parts of the expense detail page. The interactive parts live with their state in detail-client.tsx.
import { useTranslations } from "next-intl";
import { namedStops } from "@/lib/mileage/claim";
import { Button, ButtonLink } from "@/components/ui/button";
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

/** The head of the card: where the utlägg stands and the actions (top right, wrapping under the status on a phone). See components/page-shell.tsx. */
export function ExpenseSummary({
  expense,
  actions,
}: {
  expense: Expense;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-inset py-4">
      <StatusPill status={expense.status} className="mt-1.5" />
      {actions}
    </div>
  );
}

/** The amount, date and payment type in ruled columns. The rules are the grid's gap; on a phone the amount takes the first row. */
export function FactStrip({ expense }: { expense: Expense }) {
  const t = useTranslations("expenses.detail");
  const { date } = useFormat();
  return (
    <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
      <StripCell label={t("amount")} className="col-span-2 sm:col-span-1">
        <Amount value={expense.grossAmount} size="md" signed />
      </StripCell>
      {/* A milersättning has no purchase date: the field holds the day it was driven, which the filing deadline runs from. */}
      <StripCell label={expense.paymentType === "MILEAGE" ? t("journeyDate") : t("purchaseDate")}>
        {date(expense.purchaseDate)}
      </StripCell>
      <StripCell label={t("paymentType")}>
        <PaymentTag type={expense.paymentType} />
      </StripCell>
    </div>
  );
}

/** Everything else about the purchase, one label and value per line. The bank row of a card purchase is BankSection in detail-client.tsx. */
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
            <span className="mt-0.5 block text-xs italic text-muted">
              {expense.deadlineWaiver.reason}
            </span>
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

/** The journey in the page's own language, since the panel can be folded away. The subtraction is set out so a reader can check it. */
function JourneyFacts({ journey }: { journey: NonNullable<Expense["mileage"]> }) {
  const t = useTranslations("mileage");
  const reading = (km: number | null) => (km == null ? "-" : formatNumber(km, 1, 1));
  // Only stops that name a place, or a blank row would draw an arrow pointing at nothing.
  const stops = namedStops(journey.stops);

  return (
    <>
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
          <span aria-hidden className="mx-1.5 text-muted">
            →
          </span>
          {reading(journey.odometerEnd)}
          <span className="ml-1.5 text-muted">km</span>
        </span>
      </Fact>
      <Fact label={t("distance")}>
        <span className="tabular-nums">
          {journey.km == null ? "-" : t("km", { km: formatNumber(journey.km, 0, 1) })}
          {journey.orePerKm != null && (
            <span className="ml-3 text-xs text-muted">
              {t("rates.perKm", {
                amount: formatNumber(journey.orePerKm / 100, 2, 2),
              })}
            </span>
          )}
        </span>
      </Fact>
    </>
  );
}

/** What each row of the distribution can do, for the viewer. */
export type AllocationRowActions = {
  /** The utlägg is waiting for attest, so unsigned rows may be signed. */
  canAttest: boolean;
  /** The viewer's own signatures they may still take back. */
  withdrawable: string[];
  onAttest: (id: string) => void;
  onWithdraw: (id: string, costCenter: string) => void;
  /** The row whose button was pressed, while it is under way. */
  pending: string | null;
  busy: boolean;
};

/** The cost distribution. With `rowActions` each row carries its own Attestera / Dra tillbaka, for the skattmästare
 * who should sign only their own units. Given only with more than one row. */
export function AllocationSection({
  allocations,
  rowActions: r,
}: {
  allocations: Expense["allocations"];
  rowActions: AllocationRowActions | null;
}) {
  const t = useTranslations("expenses.detail");
  const name = (a: Expense["allocations"][number]) => `${a.costCenterCode} - ${a.costCenterName}`;

  const withButton = (
    a: Expense["allocations"][number],
    status: React.ReactNode,
    label: string,
    onClick: () => void,
  ) => (
    <span className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate">{status}</span>
      <Button
        variant="secondary"
        size="sm"
        loading={r?.pending === a.id}
        disabled={r?.busy}
        onClick={onClick}
        className="shrink-0"
      >
        {label}
        <span className="sr-only">{` ${name(a)}`}</span>
      </Button>
    </span>
  );

  return (
    <AllocationTable
      caption={t("distribution")}
      lines={allocations.map((a) => ({
        ...a,
        attest: a.approvedById ? (
          r?.withdrawable.includes(a.id) ? (
            withButton(a, <AttestedBy name={a.approvedByName} />, t("withdrawRow"), () =>
              r.onWithdraw(a.id, name(a)),
            )
          ) : (
            <AttestedBy name={a.approvedByName} />
          )
        ) : r?.canAttest && a.canAttest ? (
          withButton(
            a,
            <span className="font-medium text-purple">{t("yoursToAttest")}</span>,
            t("approve"),
            () => r.onAttest(a.id),
          )
        ) : (
          <span className="text-muted">{a.resultUnit ?? t("awaitingApproval")}</span>
        ),
      }))}
    />
  );
}

/** The kontering: the voucher the utlägg was booked as, a column per thing. A line's description is shown only where it differs from the voucher's. */
/** Who konterade the utlägg and who amended the voucher since (bookingTrail's rule). */
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
          // The Fortnox number beside the title, where a voucher's number sits on paper.
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
      {people && (
        <dl className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border px-inset pt-3 text-xs">
          <div className="flex items-baseline gap-2">
            <dt className={LABEL}>{t("bookedBy")}</dt>
            <dd>
              <span className="font-medium">{people.booker}</span>
              <span className="text-muted">
                , <span className="tabular-nums">{date(people.at)}</span>
              </span>
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

/** The history as small print: one line per event, a typed comment under its line. */
const EVENT_TONE: Record<string, string> = {
  COST_CENTER_APPROVED: "text-blue",
  APPROVED: "text-blue",
  CHANGES_REQUESTED: "text-danger",
  CORRECTED: "text-warning",
};

export function TimelineSection({ revisions }: { revisions: Expense["revisions"] }) {
  const t = useTranslations("expenses.detail");
  const tEvent = useTranslations("expenses.event");
  const tField = useTranslations("expenses.field");
  const { dateTime } = useFormat();

  // Two event types carry data rather than prose in `comment`: the fields an edit touched, and the voucher an export produced.
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
    // One step down from the card and last in it, so it takes the card's bottom corners.
    <section className="rounded-b-panel border-t border-border bg-canvas px-inset py-4">
      <h2 className={cn(LABEL, "mb-2")}>{t("history")}</h2>
      <ol className="space-y-1.5 text-xs">
        {revisions.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-[minmax(0,1fr)] gap-x-4 sm:grid-cols-[10rem_minmax(0,1fr)]"
          >
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
              {r.correction && (
                <span className="mt-0.5 block text-muted">
                  {t(`corrected.${r.correction.field}`, {
                    from: r.correction.from ?? "-",
                    to: r.correction.to ?? "-",
                  })}
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
