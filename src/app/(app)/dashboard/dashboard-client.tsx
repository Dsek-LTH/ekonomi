"use client";

import { expensesHref } from "@/app/(app)/expenses/scope";
import { InvoiceStatusPill } from "@/app/(app)/invoices/invoice-bits";
import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { NewExpenseMenu } from "@/components/new-expense-menu";
import { InstallHint } from "@/components/pwa/install-hint";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Tag } from "@/components/ui/status-pill";
import { IconChevronRight } from "@/components/ui/icons";
import { StarRating } from "@/components/member-score";
import { cn } from "@/lib/ui/utils";
import type { QueueAction } from "@/lib/domain/queue";
import type { UnitInvoice, UpcomingItem, WaitingOwn } from "@/lib/data/dashboard";

// A count's tag reuses the app's status colours rather than inventing a second
// language: purple is the authority chain, danger is "it came back" or "it is
// late", amber is "waiting on you", and the brand hue is the treasury's work.
type CountAction = QueueAction | "PURCHASES" | "OVERDUE" | "MEMBERS_BEHIND";

const COUNT_TONE: Record<CountAction, React.ComponentProps<typeof Tag>["tone"]> = {
  FIX: "danger",
  SUBMIT: "neutral",
  PURCHASES: "warning",
  ATTEST: "purple",
  BOOK: "accent",
  EXPORT: "accent",
  OVERDUE: "danger",
  MEMBERS_BEHIND: "warning",
};

// Where each count is worked through. A count and the way there is what the
// dashboard owes: the lists of the things themselves are those pages.
const COUNT_HREF: Record<CountAction, string> = {
  FIX: expensesHref("mine", "draft"),
  SUBMIT: expensesHref("mine", "draft"),
  PURCHASES: "/bank?scope=mine",
  ATTEST: expensesHref("unit", "attest"),
  BOOK: expensesHref("all", "book"),
  EXPORT: expensesHref("all", "export"),
  OVERDUE: "/invoices",
  MEMBERS_BEHIND: "/profile/members",
};

// Where each date in the calendar is looked at.
const CALENDAR_HREF: Record<UpcomingItem["kind"], (id: string) => string> = {
  deadline: (id) => `/expenses/${id}`,
  invoice: (id) => `/invoices/${id}`,
  pickup: (id) => `/contracts/${id}`,
  contractEnds: (id) => `/contracts/${id}`,
  stockEvent: (id) => `/stock/events/${id}`,
};

/** How many of your own waiting utlägg are named before the link to the rest. */
const WAITING_SHOWN = 6;

/** A deadline this close is shown in amber. */
const DUE_SOON_DAYS = 3;

const LINK =
  "inline-flex items-center gap-0.5 text-sm font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current";

/**
 * One line under Din tur: one thing that is late or due, or a count standing
 * for many. Built in page.tsx, which also keeps the two from overlapping.
 */
export type TurnRow =
  | { kind: "draft" | "cardPurchase" | "invoiceOverdue"; id: string; title: string; days: number }
  | { kind: "deadline"; id: string; title: string; inDays: number }
  | {
      kind: "count";
      action: CountAction;
      count: number;
      /** Some of the same kind are named above, so this is "the other N". */
      more?: boolean;
      /** For ATTEST: how many have waited past a week. */
      stale?: number;
    };

function turnHref(r: TurnRow): string {
  switch (r.kind) {
    case "count":
      return COUNT_HREF[r.action];
    case "cardPurchase":
      // Straight into an utlägg for that purchase, matched already.
      return `/expenses/new?txn=${r.id}`;
    case "invoiceOverdue":
      return `/invoices/${r.id}`;
    default:
      return `/expenses/${r.id}`;
  }
}

/** The result units off pace with their cost budget. See page.tsx. */
export interface BudgetFlags {
  budgetId: string | null;
  /** Every unit (the treasury) or the ones the viewer answers for. */
  scope: "all" | "own";
  ownCount: number;
  /** How much of the year has gone, in percent. */
  elapsed: number;
  flagged: { name: string | null; pace: "OVER" | "AHEAD"; used: number }[];
}

// See page.tsx for what this page is for.
export function DashboardClient({
  payoutMissing,
  turn,
  waiting,
  calendar,
  budget,
  fresh,
  invoices,
  stars,
}: {
  /** No clearing and account number on file, so nothing can be paid out. */
  payoutMissing: boolean;
  turn: TurnRow[];
  waiting: WaitingOwn[];
  /** Dates coming up that ask nothing of the viewer by themselves. */
  calendar: UpcomingItem[];
  /** Null for a viewer who answers for no budget. */
  budget: BudgetFlags | null;
  /** No utlägg of their own and no invoices: a first visit. */
  fresh: boolean;
  /** The latest in the viewer's own result units. Empty for most. */
  invoices: UnitInvoice[];
  /** The viewer's own redovisningsbetyg. */
  stars: number | null;
}) {
  const t = useTranslations("dashboard");
  const below = [
    calendar.length > 0 && <CalendarCard key="calendar" items={calendar} />,
    budget && <BudgetCard key="budget" budget={budget} />,
    invoices.length > 0 && <InvoicesCard key="invoices" invoices={invoices} />,
  ].filter(Boolean);

  return (
    <PageShell title={t("title")} width="content" aside={<NewExpenseMenu size="sm" />}>
      <div className="flex flex-col gap-6">
        {/* Phones only, until the app is on the home screen or the card is
            closed. The dashboard is where an installed app opens (start_url
            in app/manifest.ts), so it is where the offer belongs. */}
        <InstallHint />
        {payoutMissing && (
          <Link href="/profile" className="hover:underline">
            <Notice>{t("payoutMissing")}</Notice>
          </Link>
        )}
        {/* Before the first utlägg, the guide to making one takes the place
            of two empty cards. Wide on purpose (its steps sit two by two). */}
        {fresh && turn.length === 0 ? (
          <FirstRun />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <TurnCard rows={turn} stars={stars} />
            <WaitingCard rows={waiting} />
          </div>
        )}
        {below.length > 0 && <div className="grid items-start gap-6 lg:grid-cols-2">{below}</div>}
        {fresh && turn.length > 0 && <FirstRun />}
      </div>
    </PageShell>
  );
}

// Everything that is the viewer's move, in one list. Late things first, each
// saying how late, then what is due soon, then the counts.
function TurnCard({ rows, stars }: { rows: TurnRow[]; stars: number | null }) {
  const t = useTranslations("dashboard.turn");
  const tScore = useTranslations("score");
  const when = useRelativeDays();
  const b = (c: React.ReactNode) => <span className="font-medium">{c}</span>;

  return (
    <Card data-tour="todo">
      <CardHeader
        title={t("title")}
        action={
          // The member's own stars, where they look every day. Doing what is
          // in this card is what raises them. The breakdown is on the profile.
          <Link href="/profile" title={tScore("ownTitle")} className="inline-flex">
            <StarRating value={stars} />
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="px-inset py-4 text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="px-2 py-2">
          {rows.map((r) => (
            <li key={r.kind === "count" ? r.action : `${r.kind}-${r.id}`}>
              <Row href={turnHref(r)}>
                {r.kind === "count" ? (
                  <>
                    <CountTag tone={COUNT_TONE[r.action]} count={r.count} />
                    <span className="min-w-0 flex-1">
                      {t(r.more ? `more.${r.action}` : `count.${r.action}`, {
                        count: r.count,
                      })}
                    </span>
                    {!!r.stale && (
                      <span className="shrink-0 text-xs text-danger">
                        {t("stale", { count: r.stale })}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        "mx-2 size-2 shrink-0 rounded-full",
                        r.kind === "deadline"
                          ? r.inDays <= DUE_SOON_DAYS
                            ? "bg-warning"
                            : "bg-faint"
                          : "bg-danger",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      {t.rich(r.kind, { title: r.title || t("untitled"), b })}
                    </span>
                    {r.kind === "deadline" ? (
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          r.inDays <= DUE_SOON_DAYS ? "text-warning" : "text-muted",
                        )}
                      >
                        {t("lastDay", { when: when(r.inDays) })}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-danger">{when(-r.days)}</span>
                    )}
                  </>
                )}
              </Row>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// The viewer's own utlägg that have left them: who has each one now, and for
// how long. Answers "where did mine get to" without opening the list.
function WaitingCard({ rows }: { rows: WaitingOwn[] }) {
  const t = useTranslations("dashboard.waiting");
  const shown = rows.slice(0, WAITING_SHOWN);
  const more = rows.length - shown.length;

  return (
    <Card>
      <CardHeader
        title={t("title")}
        action={
          <Link href="/expenses" className={LINK}>
            {t("all")}
            <IconChevronRight className="size-4" />
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="px-inset py-4 text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="px-2 py-2">
          {shown.map((e) => (
            <li key={e.id}>
              <Row href={`/expenses/${e.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.title || t("untitled")}</span>
                  <span className="block text-xs text-muted">{t(e.status)}</span>
                </span>
                <span className={cn("shrink-0 text-xs", e.stuck ? "text-danger" : "text-muted")}>
                  {t("days", { count: e.days })}
                </span>
              </Row>
            </li>
          ))}
          {more > 0 && (
            <li className="px-2 pt-1 text-xs text-muted">{t("more", { count: more })}</li>
          )}
        </ul>
      )}
    </Card>
  );
}

// Dates coming up that are not a task by themselves, as an agenda: the day on
// the left, what happens on the right.
function CalendarCard({ items }: { items: UpcomingItem[] }) {
  const t = useTranslations("dashboard.calendar");
  const locale = useLocale();
  // The dates are plain days. Read them as UTC so no time zone moves them.
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    [locale],
  );

  return (
    <Card>
      <CardHeader title={t("title")} />
      <ul className="px-2 py-2">
        {items.map((i) => (
          <li key={`${i.kind}-${i.id}`}>
            <Row href={CALENDAR_HREF[i.kind](i.id)}>
              <span className="w-20 shrink-0 text-xs tabular-nums text-muted">
                {fmt.format(new Date(`${i.date}T00:00:00Z`))}
              </span>
              <span className="min-w-0 flex-1">
                {t.rich(i.kind, {
                  title: i.title || t("untitled"),
                  b: (c) => <span className="font-medium">{c}</span>,
                })}
              </span>
            </Row>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Only the units that are off pace, each as a sentence. One that keeps up with
// the year is not news, so the card says so in a line instead of listing it.
function BudgetCard({ budget }: { budget: BudgetFlags }) {
  const t = useTranslations("dashboard.budget");
  const href = budget.budgetId ? `/budget/${budget.budgetId}` : "/budget";

  return (
    <Card>
      <CardHeader
        title={t("title")}
        action={
          <Link href={href} className={LINK}>
            {t("open")}
            <IconChevronRight className="size-4" />
          </Link>
        }
      />
      {!budget.budgetId ? (
        <p className="px-inset py-4 text-sm text-muted">{t("noBudget")}</p>
      ) : budget.flagged.length === 0 ? (
        <p className="px-inset py-4 text-sm text-muted">
          {budget.scope === "all" ? t("allFine") : t("ownFine", { count: budget.ownCount })}
        </p>
      ) : (
        <ul className="px-2 py-2">
          {budget.flagged.map((u) => {
            const unit = u.name ?? t("noUnit");
            return (
              <li key={unit}>
                <Row href={href}>
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      u.pace === "OVER" ? "bg-danger" : "bg-warning",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    {u.pace === "OVER"
                      ? t("over", { unit })
                      : t("ahead", {
                          unit,
                          used: u.used,
                          elapsed: budget.elapsed,
                        })}
                  </span>
                </Row>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// For an utskottsmästare, the latest invoices in their units, by name and
// where each one is. Amounts and dates are on the list, one click away.
function InvoicesCard({ invoices }: { invoices: UnitInvoice[] }) {
  const t = useTranslations("dashboard");
  return (
    <Card>
      <CardHeader
        title={t("invoicesTitle")}
        action={
          <Link href="/invoices?scope=unit" className={LINK}>
            {t("allInvoices")}
            <IconChevronRight className="size-4" />
          </Link>
        }
      />
      <ul className="px-2 py-2">
        {invoices.map((i) => (
          <li key={i.id}>
            <Row href={`/invoices/${i.id}`}>
              <span className="min-w-0 flex-1 truncate">{i.title || t("invoiceUntitled")}</span>
              <InvoiceStatusPill status={i.status} />
            </Row>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// "idag", "imorgon", "om 5 dagar", "för 2 dagar sedan", in the reader's
// language. The day counts come from the server, so both renders agree.
function useRelativeDays() {
  const locale = useLocale();
  return useMemo(() => {
    const f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return (days: number) => f.format(days, "day");
  }, [locale]);
}

function CountTag({
  tone,
  count,
}: {
  tone: React.ComponentProps<typeof Tag>["tone"];
  count: number;
}) {
  return (
    <Tag tone={tone} size="sm" className="min-w-6 justify-center tabular-nums">
      {count}
    </Tag>
  );
}

// A row in a list rather than a button: a stack of buttons reads as a toolbar.
function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-control px-2 py-2 text-sm hover:bg-hover"
    >
      {children}
      <IconChevronRight className="size-4 shrink-0 text-muted" />
    </Link>
  );
}

// What a functionary who has never seen this app needs: not four zeroes, but
// the shape of the whole path and where their part of it ends. Step four names
// the payout account, the thing that actually strands people.
function FirstRun() {
  const t = useTranslations("dashboard.firstRun");
  const steps = [1, 2, 3, 4] as const;

  return (
    <Card>
      <div className="px-inset py-8">
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="mt-2 max-w-prose text-[15px] text-muted">{t("lead")}</p>

        <ol className="mt-8 grid gap-6 sm:grid-cols-2">
          {steps.map((n) => (
            <li key={n} className="flex gap-4">
              {/* Numbered because the order is the information: this is a path,
                  not a feature list. The four circles walk the brand ramp from
                  pink to violet, the same distance the utlägg travels.
                  color-mix against the tokens so the dark theme's own endpoints
                  apply. */}
              <span
                style={{
                  backgroundColor: `color-mix(in srgb, var(--color-brand-end) ${
                    ((n - 1) / (steps.length - 1)) * 100
                  }%, var(--color-brand))`,
                }}
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-on-brand"
              >
                {n}
              </span>
              <div className="min-w-0">
                <p className="font-medium">{t(`step${n}Title`)}</p>
                <p className="mt-1 text-sm text-muted">{t(`step${n}Body`)}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8">
          <NewExpenseMenu label={t("cta")} />
        </div>
      </div>
    </Card>
  );
}
