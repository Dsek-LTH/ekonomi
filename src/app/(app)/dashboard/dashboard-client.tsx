"use client";

import { expensesHref } from "@/app/(app)/expenses/scope";
import { InvoiceStatusPill } from "@/app/(app)/invoices/invoice-bits";
import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { NewExpenseMenu } from "@/components/new-expense-menu";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatusPill, Tag } from "@/components/ui/status-pill";
import { IconChevronRight } from "@/components/ui/icons";
import { StarRating } from "@/components/member-score";
import { cn } from "@/lib/ui/utils";
import type { QueueAction, QueueItem } from "@/lib/domain/queue";
import type { Expense } from "@/lib/domain/types";
import type { UnitInvoice, UpcomingItem } from "@/lib/data/dashboard";

// The queue's action reuses the app's status colours rather than inventing a
// second language: purple is the authority chain, danger is "it came back",
// amber is "waiting on you", and the brand hue is the treasury's own work.
const ACTION_TONE: Record<QueueAction, React.ComponentProps<typeof Tag>["tone"]> = {
  FIX: "danger",
  SUBMIT: "neutral",
  ATTEST: "purple",
  BOOK: "accent",
  EXPORT: "accent",
};

// Where each action is done. A count and the way there is what the dashboard
// owes: the lists of the utlägg themselves are those pages.
const ACTION_HREF: Record<QueueAction, string> = {
  FIX: expensesHref("mine", "draft"),
  SUBMIT: expensesHref("mine", "draft"),
  ATTEST: expensesHref("unit", "attest"),
  BOOK: expensesHref("all", "book"),
  EXPORT: expensesHref("all", "export"),
};

const ACTION_ORDER: QueueAction[] = ["FIX", "SUBMIT", "ATTEST", "BOOK", "EXPORT"];

// Where each thing coming up is looked at.
const UPCOMING_HREF: Record<UpcomingItem["kind"], (id: string) => string> = {
  deadline: (id) => `/expenses/${id}`,
  invoice: (id) => `/invoices/${id}`,
  pickup: (id) => `/contracts/${id}`,
  contractEnds: (id) => `/contracts/${id}`,
  stockEvent: (id) => `/stock/events/${id}`,
};

/** How many rows Glömt shows before saying how many more there are. */
const FORGOTTEN_SHOWN = 6;

const LINK =
  "inline-flex items-center gap-0.5 text-sm font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current";

/** One line under Glömt: a count standing for many, or one thing. */
export type ForgottenRow =
  | { kind: "attestWaiting" | "membersBehind"; count: number }
  | { kind: "draft" | "cardPurchase" | "stuck" | "invoiceOverdue"; id: string; title: string; days: number };

function forgottenHref(r: ForgottenRow): string {
  switch (r.kind) {
    case "attestWaiting":
      return ACTION_HREF.ATTEST;
    case "membersBehind":
      return "/profile/members";
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
  queue,
  unaccountedPurchases,
  payoutMissing,
  forgotten,
  upcoming,
  budget,
  mine,
  invoices,
  stars,
}: {
  queue: QueueItem[];
  /** The viewer's own card purchases with no utlägg yet. */
  unaccountedPurchases: number;
  /** No clearing and account number on file, so nothing can be paid out. */
  payoutMissing: boolean;
  forgotten: ForgottenRow[];
  upcoming: UpcomingItem[];
  /** Null for a viewer who answers for no budget. */
  budget: BudgetFlags | null;
  mine: Expense[];
  /** The latest in the viewer's own result units. Empty for most. */
  invoices: UnitInvoice[];
  /** The viewer's own redovisningsbetyg. */
  stars: number | null;
}) {
  const t = useTranslations("dashboard");
  const fresh = mine.length === 0 && invoices.length === 0;

  return (
    <PageShell title={t("title")} width="content" aside={<NewExpenseMenu size="sm" />}>
      <div className="flex flex-col gap-6">
        {payoutMissing && (
          <Link href="/profile" className="hover:underline">
            <Notice>{t("payoutMissing")}</Notice>
          </Link>
        )}
        {/* Past, now, soon, read left to right. On a phone they stack in the
            same order, so what has been forgotten is the first thing. */}
        <div className="grid gap-6 lg:grid-cols-3">
          <ForgottenCard rows={forgotten} />
          <TodoCard queue={queue} unaccountedPurchases={unaccountedPurchases} />
          <UpcomingCard items={upcoming} />
        </div>
        {(budget || !fresh) && (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {budget && <BudgetCard budget={budget} />}
            {!fresh && (
              <div className={cn("min-w-0", !budget && "lg:col-span-2")}>
                <MineCard mine={mine} invoices={invoices} stars={stars} />
              </div>
            )}
          </div>
        )}
        {/* Before the first utlägg, the guide to making one. Wide on purpose
            (its steps sit two by two), so it spans the page. */}
        {fresh && <FirstRun />}
      </div>
    </PageShell>
  );
}

// What should already have happened and has not.
function ForgottenCard({ rows }: { rows: ForgottenRow[] }) {
  const t = useTranslations("dashboard.forgotten");
  const when = useRelativeDays();
  const shown = rows.slice(0, FORGOTTEN_SHOWN);
  const more = rows.length - shown.length;
  const b = (c: React.ReactNode) => <span className="font-medium">{c}</span>;

  return (
    <Card className="h-full">
      <CardHeader title={t("title")} />
      {rows.length === 0 ? (
        <p className="px-inset py-4 text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="px-2 py-2">
          {shown.map((r) => (
            <li key={"id" in r ? `${r.kind}-${r.id}` : r.kind}>
              <Row href={forgottenHref(r)}>
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-danger" />
                <span className="min-w-0 flex-1">
                  {"count" in r
                    ? t(r.kind, { count: r.count })
                    : t.rich(r.kind, { title: r.title || t("untitled"), b })}
                </span>
                {"days" in r && <span className="shrink-0 text-xs text-muted">{when(-r.days)}</span>}
              </Row>
            </li>
          ))}
          {more > 0 && <li className="px-2 pt-1 text-xs text-muted">{t("more", { count: more })}</li>}
        </ul>
      )}
    </Card>
  );
}

// What waits on you, as counts that go where the work is.
function TodoCard({ queue, unaccountedPurchases }: { queue: QueueItem[]; unaccountedPurchases: number }) {
  const t = useTranslations("dashboard");

  const counts = useMemo(() => {
    const n = new Map<QueueAction, number>();
    for (const i of queue) n.set(i.action, (n.get(i.action) ?? 0) + 1);
    return ACTION_ORDER.filter((a) => n.has(a)).map((a) => ({ action: a, count: n.get(a)! }));
  }, [queue]);

  return (
    <Card className="h-full" data-tour="todo">
      <CardHeader title={t("todoTitle")} />
      {counts.length === 0 && unaccountedPurchases === 0 ? (
        <p className="px-inset py-4 text-sm text-muted">{t("todoEmpty")}</p>
      ) : (
        <ul className="px-2 py-2">
          {counts.map(({ action, count }) => (
            <li key={action}>
              <Row href={ACTION_HREF[action]}>
                <CountTag tone={ACTION_TONE[action]} count={count} />
                <span className="min-w-0 flex-1">{t(`todo.${action}`, { count })}</span>
              </Row>
            </li>
          ))}
          {unaccountedPurchases > 0 && (
            <li>
              <Row href="/bank?scope=mine">
                <CountTag tone="warning" count={unaccountedPurchases} />
                <span className="min-w-0 flex-1">
                  {t("todo.PURCHASES", { count: unaccountedPurchases })}
                </span>
              </Row>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

// Things with a date, soonest first.
function UpcomingCard({ items }: { items: UpcomingItem[] }) {
  const t = useTranslations("dashboard.upcoming");
  const when = useRelativeDays();
  return (
    <Card className="h-full">
      <CardHeader title={t("title")} />
      {items.length === 0 ? (
        <p className="px-inset py-4 text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="px-2 py-2">
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`}>
              <Row href={UPCOMING_HREF[i.kind](i.id)}>
                <span className="min-w-0 flex-1">
                  {t.rich(i.kind, {
                    title: i.title || t("untitled"),
                    b: (c) => <span className="font-medium">{c}</span>,
                  })}
                </span>
                <span className="shrink-0 text-xs text-muted">{when(i.inDays)}</span>
              </Row>
            </li>
          ))}
        </ul>
      )}
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
                    className={cn("size-2 shrink-0 rounded-full", u.pace === "OVER" ? "bg-danger" : "bg-warning")}
                  />
                  <span className="min-w-0 flex-1">
                    {u.pace === "OVER"
                      ? t("over", { unit })
                      : t("ahead", { unit, used: u.used, elapsed: budget.elapsed })}
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

// Your own latest utlägg, and for an utskottsmästare the latest invoices in
// their units, by name and where each one is. Amounts and dates are on the
// lists, one click away.
function MineCard({ mine, invoices, stars }: { mine: Expense[]; invoices: UnitInvoice[]; stars: number | null }) {
  const t = useTranslations("dashboard");
  const tScore = useTranslations("score");
  const both = mine.length > 0 && invoices.length > 0;
  return (
    <Card>
      <CardHeader
        title={both ? t("mineAndInvoicesTitle") : invoices.length > 0 ? t("invoicesTitle") : t("mineTitle")}
        action={
          // The member's own stars, where they look every day. The breakdown
          // is on the profile.
          <Link href="/profile" title={tScore("ownTitle")} className="inline-flex">
            <StarRating value={stars} />
          </Link>
        }
      />
      {mine.length > 0 && (
        <Section label={both ? t("mineTitle") : null} href="/expenses" linkLabel={t("allExpenses")}>
          {mine.map((e) => (
            <li key={e.id}>
              <Row href={`/expenses/${e.id}`}>
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                <StatusPill status={e.status} />
              </Row>
            </li>
          ))}
        </Section>
      )}
      {invoices.length > 0 && (
        <Section label={both ? t("invoicesTitle") : null} href="/invoices?scope=unit" linkLabel={t("allInvoices")}>
          {invoices.map((i) => (
            <li key={i.id}>
              <Row href={`/invoices/${i.id}`}>
                <span className="min-w-0 flex-1 truncate">{i.title || t("invoiceUntitled")}</span>
                <InvoiceStatusPill status={i.status} />
              </Row>
            </li>
          ))}
        </Section>
      )}
    </Card>
  );
}

/** A list inside MineCard, with its own small heading where there are two. */
function Section({
  label,
  href,
  linkLabel,
  children,
}: {
  label: string | null;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between px-inset pt-3 text-xs font-medium text-muted">
        <span>{label}</span>
        <Link href={href} className={LINK}>
          {linkLabel}
          <IconChevronRight className="size-4" />
        </Link>
      </div>
      <ul className="px-2 pb-2 pt-1">{children}</ul>
    </div>
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

function CountTag({ tone, count }: { tone: React.ComponentProps<typeof Tag>["tone"]; count: number }) {
  return (
    <Tag tone={tone} size="sm" className="min-w-6 justify-center tabular-nums">
      {count}
    </Tag>
  );
}

// A row in a list rather than a button: a stack of buttons reads as a toolbar.
function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-control px-2 py-2 text-sm hover:bg-hover">
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
