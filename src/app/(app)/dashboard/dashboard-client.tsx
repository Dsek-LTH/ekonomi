"use client";

import { expensesHref } from "@/app/(app)/expenses/scope";
import { InvoiceStatusPill } from "@/app/(app)/invoices/invoice-bits";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { NewExpenseMenu } from "@/components/new-expense-menu";
import { InstallHint } from "@/components/pwa/install-hint";
import { StepNumber } from "@/components/pwa/install-steps";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyNote } from "@/components/ui/empty-state";
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

/** Dates in Kalender before the rest wait behind "show more". */
const CALENDAR_SHOWN = 6;

/** Result units drawn as bars before the link to the whole budget. */
const BUDGET_SHOWN = 5;

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
  /** Every unit with a cost budget, the ones off pace first. */
  units: { name: string | null; pace: "OVER" | "AHEAD" | "ON_TRACK"; used: number }[];
}

// See page.tsx for what this page is for.
export function DashboardClient({
  firstName,
  lateCount,
  payoutMissing,
  turn,
  waiting,
  calendar,
  budget,
  fresh,
  invoices,
  stars,
}: {
  firstName: string;
  /** Everything of the viewer's that is late, named in Din tur or not. */
  lateCount: number;
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
  const side = [
    calendar.length > 0 && <CalendarCard key="calendar" items={calendar} />,
    budget && <BudgetCard key="budget" budget={budget} />,
    invoices.length > 0 && <InvoicesCard key="invoices" invoices={invoices} />,
  ].filter(Boolean);

  return (
    <PageShell
      // The person, not the page's name: the phone's top bar and the nav
      // already say Översikt, and this is the one page that is about them.
      title={t("greeting", { name: firstName })}
      width="content"
      // Not on a phone, where the tab bar's + is the same menu one thumb away.
      aside={
        <div className="max-md:hidden">
          <NewExpenseMenu size="sm" />
        </div>
      }
    >
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
        <Tiles
          turn={turn}
          lateCount={lateCount}
          waiting={waiting}
          stars={stars}
          budget={budget}
          calendar={calendar}
        />
        {/* Two columns from lg: what is yours to do, wide, and beside it what
            is coming and how the money is doing. The same two whatever there
            is, so the page does not change shape with the data. Without
            anything for the side, the main pair stands side by side instead. */}
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div
            className={cn(
              "grid items-start gap-6",
              side.length > 0 ? "lg:col-span-2" : "lg:col-span-3 lg:grid-cols-2",
            )}
          >
            {/* Before the first utlägg, the guide to making one takes the
                place of two empty cards. */}
            {fresh && turn.length === 0 ? (
              <FirstRun />
            ) : (
              <>
                <TurnCard rows={turn} stars={stars} />
                <WaitingCard rows={waiting} />
              </>
            )}
          </div>
          {side.length > 0 && <div className="grid items-start gap-6">{side}</div>}
        </div>
        {/* Still worth reading with work already waiting (an attester's first
            visit), but after it, at the foot rather than between the cards. */}
        {fresh && turn.length > 0 && <FirstRun />}
      </div>
    </PageShell>
  );
}

/**
 * The page's figures at a glance, each a way into where it is worked through.
 * Two by two on a phone, one row from md. The fourth is the budget for whoever
 * watches one, and otherwise the dates coming up.
 */
function Tiles({
  turn,
  lateCount,
  waiting,
  stars,
  budget,
  calendar,
}: {
  turn: TurnRow[];
  lateCount: number;
  waiting: WaitingOwn[];
  stars: number | null;
  budget: BudgetFlags | null;
  calendar: UpcomingItem[];
}) {
  const t = useTranslations("dashboard.tiles");
  const todo = turn.reduce((n, r) => n + (r.kind === "count" ? r.count : 1), 0);
  const stuck = waiting.filter((w) => w.stuck).length;
  const off = budget?.units.filter((u) => u.pace !== "ON_TRACK").length ?? 0;
  const over = budget?.units.filter((u) => u.pace === "OVER").length ?? 0;
  const date = useShortDate();

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile
        href="#din-tur"
        label={t("turn")}
        value={todo}
        note={lateCount > 0 ? t("late", { count: lateCount }) : t("nothingLate")}
        alert={lateCount > 0}
      />
      <StatTile
        href="/expenses"
        label={t("waiting")}
        value={waiting.length}
        note={stuck > 0 ? t("stuck", { count: stuck }) : t("noneStuck")}
        alert={stuck > 0}
      />
      <StatTile
        href="/profile"
        label={t("score")}
        value={<StarRating value={stars} />}
        note={t("scoreNote")}
      />
      {budget ? (
        <StatTile
          href={budget.budgetId ? `/budget/${budget.budgetId}` : "/budget"}
          label={t("budget")}
          value={t("budgetValue", { off, total: budget.units.length })}
          // What is wrong, in red, when something is: a unit past its whole
          // year's budget. Otherwise how far the year has got, which is what
          // "ahead of pace" is measured against.
          note={over > 0 ? t("over", { count: over }) : t("elapsed", { elapsed: budget.elapsed })}
          alert={over > 0}
        />
      ) : (
        <StatTile
          href="#kalender"
          label={t("calendar")}
          value={calendar.length}
          note={
            calendar.length > 0 ? t("next", { date: date(calendar[0].date) }) : t("nothingComing")
          }
        />
      )}
    </div>
  );
}

function StatTile({
  href,
  label,
  value,
  note,
  alert = false,
}: {
  href: string;
  label: string;
  value: React.ReactNode;
  note: string;
  /** The note is something to act on, in the danger colour. */
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 flex-col rounded-panel border border-border bg-background px-4 py-3 transition-colors hover:bg-hover"
    >
      <span className="truncate text-xs font-medium text-muted">{label}</span>
      <span className="mt-1 flex h-8 items-center text-2xl font-semibold tabular-nums">
        {value}
      </span>
      <span className={cn("mt-0.5 truncate text-xs", alert ? "text-danger" : "text-muted")}>
        {note}
      </span>
    </Link>
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
    <Card id="din-tur" data-tour="todo" className="scroll-mt-24">
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
        <EmptyNote>{t("empty")}</EmptyNote>
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
        <EmptyNote>{t("empty")}</EmptyNote>
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
            <li className="px-2 pt-1">
              <Link href="/expenses" className={LINK}>
                {t("more", { count: more })}
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

// Dates coming up that are not a task by themselves, as an agenda: the day on
// the left, what happens on the right. The nearest few, and the rest on asking.
function CalendarCard({ items }: { items: UpcomingItem[] }) {
  const t = useTranslations("dashboard.calendar");
  const [all, setAll] = useState(false);
  const locale = useLocale();
  // The dates are plain days. Read them as UTC so no time zone moves them.
  const [day, month] = useMemo(
    () => [
      new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }),
      new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }),
    ],
    [locale],
  );
  const shown = all ? items : items.slice(0, CALENDAR_SHOWN);
  const more = items.length - shown.length;

  return (
    <Card id="kalender" className="scroll-mt-24">
      <CardHeader title={t("title")} />
      <ul className="px-2 py-2">
        {shown.map((i) => {
          const date = new Date(`${i.date}T00:00:00Z`);
          return (
            <li key={`${i.kind}-${i.id}`}>
              <Row href={CALENDAR_HREF[i.kind](i.id)}>
                {/* A leaf off a calendar: the month small over the day. */}
                <span className="flex w-10 shrink-0 flex-col items-center rounded-control border border-border py-0.5 leading-tight">
                  <span className="text-[10px] uppercase text-muted">{month.format(date)}</span>
                  <span className="text-sm font-semibold tabular-nums">{day.format(date)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  {t.rich(i.kind, {
                    title: i.title || t("untitled"),
                    b: (c) => <span className="font-medium">{c}</span>,
                  })}
                </span>
              </Row>
            </li>
          );
        })}
        {more > 0 && (
          <li className="px-2 pt-1">
            <button type="button" onClick={() => setAll(true)} className={LINK}>
              {t("more", { count: more })}
            </button>
          </li>
        )}
      </ul>
    </Card>
  );
}

// Each unit as a bar of its cost budget used, with a tick where the year has
// got to: a bar past its tick is spending ahead of the year. The furthest gone
// first, and the rest of them on the budget itself.
function BudgetCard({ budget }: { budget: BudgetFlags }) {
  const t = useTranslations("dashboard.budget");
  const href = budget.budgetId ? `/budget/${budget.budgetId}` : "/budget";
  const shown = budget.units.slice(0, BUDGET_SHOWN);
  const more = budget.units.length - shown.length;
  const fine = budget.units.every((u) => u.pace === "ON_TRACK");

  return (
    <Card>
      <CardHeader
        title={t("title")}
        subtitle={budget.budgetId ? t("elapsed", { elapsed: budget.elapsed }) : undefined}
        action={
          <Link href={href} className={LINK}>
            {t("open")}
            <IconChevronRight className="size-4" />
          </Link>
        }
      />
      {!budget.budgetId ? (
        <EmptyNote>{t("noBudget")}</EmptyNote>
      ) : budget.units.length === 0 ? (
        <EmptyNote>
          {budget.scope === "all" ? t("allFine") : t("ownFine", { count: budget.ownCount })}
        </EmptyNote>
      ) : (
        <ul className="px-2 py-2">
          {fine && (
            <li className="px-2 pb-1 text-sm text-muted">
              {budget.scope === "all" ? t("allFine") : t("ownFine", { count: budget.ownCount })}
            </li>
          )}
          {shown.map((u) => {
            const unit = u.name ?? t("noUnit");
            const sentence =
              u.pace === "OVER"
                ? t("over", { unit })
                : t(u.pace === "AHEAD" ? "ahead" : "onTrack", {
                    unit,
                    used: u.used,
                    elapsed: budget.elapsed,
                  });
            return (
              <li key={unit}>
                <Link
                  href={href}
                  title={sentence}
                  className="block rounded-control px-2 py-2 text-sm hover:bg-hover"
                >
                  <span className="sr-only">{sentence}</span>
                  <span aria-hidden className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">{unit}</span>
                    <span
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        u.pace === "OVER"
                          ? "text-danger"
                          : u.pace === "AHEAD"
                            ? "text-warning"
                            : "text-muted",
                      )}
                    >
                      {t("used", { used: u.used })}
                    </span>
                  </span>
                  <span aria-hidden className="relative mt-1.5 block h-1.5 rounded-full bg-surface">
                    <span
                      style={{ width: `${Math.min(u.used, 100)}%` }}
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full",
                        u.pace === "OVER"
                          ? "bg-danger"
                          : u.pace === "AHEAD"
                            ? "bg-warning"
                            : "bg-success",
                      )}
                    />
                    {/* Where the year has got to. */}
                    <span
                      style={{ left: `${budget.elapsed}%` }}
                      className="absolute -inset-y-0.5 w-px bg-foreground/50"
                    />
                  </span>
                </Link>
              </li>
            );
          })}
          {more > 0 && (
            <li className="px-2 pt-1">
              <Link href={href} className={LINK}>
                {t("showAll", { count: budget.units.length })}
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

// For an utskottsmästare, the latest invoices in their units, by name and
// where each one is. Amounts and dates are on the list, one click away.
function InvoicesCard({ invoices }: { invoices: UnitInvoice[] }) {
  const t = useTranslations("dashboard.invoices");
  return (
    <Card>
      <CardHeader
        title={t("title")}
        action={
          <Link href="/invoices?scope=unit" className={LINK}>
            {t("all")}
            <IconChevronRight className="size-4" />
          </Link>
        }
      />
      <ul className="px-2 py-2">
        {invoices.map((i) => (
          <li key={i.id}>
            <Row href={`/invoices/${i.id}`}>
              <span className="min-w-0 flex-1 truncate">{i.title || t("untitled")}</span>
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

// "4 nov.", for a plain day from the server, read as UTC so no time zone
// moves it.
function useShortDate() {
  const locale = useLocale();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    return (date: string) => f.format(new Date(`${date}T00:00:00Z`));
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
                  not a feature list. In the brand's pink, as the home-screen
                  steps in the app tour are. */}
              <StepNumber n={n} size="md" />
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
