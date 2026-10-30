"use client";

import { expensesHref } from "@/app/(app)/expenses/scope";
import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { NewExpenseMenu } from "@/components/new-expense-menu";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyNote } from "@/components/ui/empty-state";
import { Amount } from "@/components/ui/amount";
import { StatusPill, Tag } from "@/components/ui/status-pill";
import { IconChevronRight } from "@/components/ui/icons";
import { type Column } from "@/components/ui/data-table";
import { ClientDataTable } from "@/components/ui/client-data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import {
  expenseAmountColumn,
  expenseDateColumn,
  expensePaymentTypeColumn,
  expenseReferenceColumn,
  expenseStatusColumn,
  expenseTitleColumn,
} from "@/components/columns/expense-columns";
import type { QueueAction, QueueItem } from "@/lib/domain/queue";
import type { Expense } from "@/lib/domain/types";
import type { BudgetOverview } from "@/lib/data/budget-overview";
import type { MyMoney } from "@/lib/data/my-money";
import { useFormat } from "@/lib/ui/use-format";
import { StarRating } from "@/components/member-score";
import { BudgetOverviewCard } from "./budget-overview-card";
import { BudgetKpis } from "./budget-kpis";
import { MyMoneyCard } from "./my-money-card";
import type { DashboardView } from "./view";

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

// See page.tsx for who gets which view and why.
export function DashboardClient({
  view,
  views,
  queue,
  unaccountedPurchases,
  payoutMissing,
  mine,
  budget,
  money,
  showBudgetLink,
  score,
  behind,
}: {
  view: DashboardView;
  /** The views this person may pick between. One is not a choice. */
  views: DashboardView[];
  queue: QueueItem[];
  /** The viewer's own card purchases with no utlägg yet. */
  unaccountedPurchases: number;
  /** No clearing and account number on file, so nothing can be paid out. */
  payoutMissing: boolean;
  mine: Expense[];
  /** For the unit and section views. */
  budget: { overview: BudgetOverview; ownUnits: string[]; yearElapsed: number } | null;
  /** For the personal view. */
  money: MyMoney | null;
  showBudgetLink: boolean;
  /** The viewer's own redovisningsbetyg, and the oldest purchase still waiting. */
  score: OwnScore;
  /** Who has purchases waiting the longest, for the holders of
   *  MEMBER_SCORE_VIEW. Null for everyone else. */
  behind: BehindRow[] | null;
}) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setView(next: string) {
    const q = new URLSearchParams(params.toString());
    // `scope`, as on every list: which reading of the page is whose.
    q.set("scope", next);
    router.push(`${pathname}?${q.toString()}`);
  }

  const unitsInView =
    budget &&
    (view === "unit"
      ? budget.overview.units.filter((u) => u.name !== null && budget.ownUnits.includes(u.name))
      : budget.overview.units);

  return (
    <PageShell
      title={t("title")}
      collections={
        views.length > 1
          ? {
              label: t("viewLabel"),
              value: view,
              onChange: setView,
              options: views.map((v) => ({ value: v, label: t(`view.${v}`) })),
            }
          : undefined
      }
    >
      {/* Yours on the right, the view on the left. On a phone the right
          column comes first: what is waiting on you outranks any figure. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-1">
          {view === "personal" ? (
            <>
              {money && <MyMoneyCard money={money} />}
              {mine.length > 0 ? <MineTable mine={mine} /> : <FirstRun />}
              {showBudgetLink && (
                <Link
                  href="/budget"
                  className="inline-flex items-center gap-1 self-start text-sm font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current"
                >
                  {t("budgetLink")}
                  <IconChevronRight className="size-4" />
                </Link>
              )}
            </>
          ) : (
            budget &&
            unitsInView && (
              <>
                <BudgetKpis units={unitsInView} />
                <BudgetOverviewCard
                  overview={budget.overview}
                  ownUnits={budget.ownUnits}
                  yearElapsed={budget.yearElapsed}
                  only={view === "unit" ? budget.ownUnits : undefined}
                />
              </>
            )
          )}
        </div>
        <div className="order-1 flex flex-col gap-6 lg:order-2">
          <YouPanel
            queue={queue}
            unaccountedPurchases={unaccountedPurchases}
            payoutMissing={payoutMissing}
            // The personal view shows them large on the left already.
            mine={view === "personal" ? null : mine}
            score={score}
          />
          {behind && behind.length > 0 && <BehindCard rows={behind} />}
        </div>
      </div>
    </PageShell>
  );
}

// The right column: the same for everybody. What is waiting on you as a list
// of counts that go where the work is, a warning if you cannot be paid, the
// way to start an utlägg, and (when the left column is the budget) your own.
function YouPanel({
  queue,
  unaccountedPurchases,
  payoutMissing,
  mine,
  score,
}: {
  queue: QueueItem[];
  unaccountedPurchases: number;
  payoutMissing: boolean;
  mine: Expense[] | null;
  score: OwnScore;
}) {
  const t = useTranslations("dashboard");
  const tScore = useTranslations("score");
  const { date } = useFormat();

  const counts = useMemo(() => {
    const n = new Map<QueueAction, number>();
    for (const i of queue) n.set(i.action, (n.get(i.action) ?? 0) + 1);
    return ACTION_ORDER.filter((a) => n.has(a)).map((a) => ({ action: a, count: n.get(a)! }));
  }, [queue]);

  return (
    <Card>
      <CardHeader title={t("youTitle")} action={<NewExpenseMenu size="sm" />} />
      {payoutMissing && (
        <Link
          href="/profile"
          className="flex items-start gap-2 border-b border-border bg-warning-soft px-inset py-3 text-sm text-warning hover:underline"
        >
          {t("payoutMissing")}
        </Link>
      )}
      <div className="px-inset pt-3 text-xs font-medium text-muted">{t("todoTitle")}</div>
      {counts.length === 0 && unaccountedPurchases === 0 ? (
        <p className="px-inset pb-4 pt-1 text-sm text-muted">{t("todoEmpty")}</p>
      ) : (
        <ul className="px-2 pb-3 pt-1">
          {counts.map(({ action, count }) => (
            <li key={action}>
              <TodoRow href={ACTION_HREF[action]} count={count} tone={ACTION_TONE[action]}>
                {t(`todo.${action}`, { count })}
              </TodoRow>
            </li>
          ))}
          {unaccountedPurchases > 0 && (
            <li>
              <TodoRow href="/bank?scope=mine" count={unaccountedPurchases} tone="warning">
                {t("todo.PURCHASES", { count: unaccountedPurchases })}
              </TodoRow>
            </li>
          )}
        </ul>
      )}
      {/* The member's own stars, where they look every day rather than
          only on the profile, and what sending would raise them. Not shown
          while there are no stars and nothing waits: a "Ny" alone says
          nothing worth the room. */}
      {(score.stars !== null || score.next) && (
        <Link href="/profile" className="block border-t border-border px-inset py-3 hover:bg-hover">
          <span className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted">{tScore("ownTitle")}</span>
            <StarRating value={score.stars} />
          </span>
          {score.next && (
            <span className="mt-1 block text-sm">
              {tScore("ownHint", { title: score.next.title || tScore("kind.draft"), date: date(score.next.startedOn) })}
            </span>
          )}
        </Link>
      )}
      {mine && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between px-inset pt-3 text-xs font-medium text-muted">
            <span>{t("mineTitle")}</span>
            <Link href="/expenses" className="inline-flex items-center gap-0.5 text-accent underline decoration-faint underline-offset-2 hover:decoration-current">
              {t("allExpenses")}
              <IconChevronRight className="size-3.5" />
            </Link>
          </div>
          {mine.length === 0 ? (
            <EmptyNote size="compact">{t("mineNone")}</EmptyNote>
          ) : (
            <ul className="px-2 pb-3 pt-1">
              {mine.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/expenses/${e.id}`}
                    className="flex items-center gap-3 rounded-control px-2 py-2 hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{e.title}</span>
                      <StatusPill status={e.status} className="mt-1" />
                    </span>
                    <Amount value={e.grossAmount} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

interface OwnScore {
  stars: number | null;
  next: { title: string; startedOn: string } | null;
}

interface BehindRow {
  userId: string;
  name: string;
  stars: number | null;
  waiting: number;
  oldestDays: number;
}

// For the one who chases late utlägg: the members whose purchases have waited
// longest, each opening their breakdown on the profile's Medlemmar tab. Absent
// when nobody is behind, rather than a card saying so every day.
function BehindCard({ rows }: { rows: BehindRow[] }) {
  const t = useTranslations("score");
  const tList = useTranslations("score.list");
  return (
    <Card>
      <CardHeader
        title={t("behindTitle")}
        action={
          <Link
            href="/profile/members"
            className="inline-flex items-center gap-0.5 text-xs font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current"
          >
            {t("behindAll")}
            <IconChevronRight className="size-3.5" />
          </Link>
        }
      />
      <ul className="px-2 pb-3 pt-1">
        {rows.map((r) => (
          <li key={r.userId}>
            <Link
              href={`/profile/members?id=${r.userId}`}
              className="flex items-center gap-3 rounded-control px-2 py-2 hover:bg-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.name}</span>
                <span className="block truncate text-xs text-muted">
                  {tList("waitingSummary", { count: r.waiting, days: r.oldestDays })}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// A row in a list rather than a button: the column is narrow, and a stack of
// buttons reads as a toolbar. The count is a tag in the queue's colour for that
// action, the language the lists it opens already use.
function TodoRow({
  href,
  count,
  tone,
  children,
}: {
  href: string;
  count: number;
  tone: React.ComponentProps<typeof Tag>["tone"];
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-control px-2 py-2 text-sm hover:bg-hover"
    >
      <Tag tone={tone} size="sm" className="min-w-6 justify-center tabular-nums">
        {count}
      </Tag>
      <span className="min-w-0 flex-1">{children}</span>
      <IconChevronRight className="size-4 shrink-0 text-muted" />
    </Link>
  );
}

// Your own utlägg, large, for the personal view where they are the page.
function MineTable({ mine }: { mine: Expense[] }) {
  const t = useTranslations("dashboard");
  const tCol = useTranslations("expenses.col");
  const tList = useTranslations("expenses");
  const tPayment = useTranslations("common.payment");
  const { date } = useFormat();
  const controls = useTableControls();

  // The utlägg, bokförings- and attestlistorna's columns, in their order, so a
  // row here says the same things as the same row on the list it opens.
  const columns = useMemo<Column<Expense>[]>(
    () => [
      expenseReferenceColumn(tCol("verification")),
      expenseTitleColumn(tCol("title"), { reference: false }),
      expenseDateColumn(tCol("date"), date),
      expensePaymentTypeColumn(tCol("type"), (type) => tPayment(`${type}.label`)),
      expenseStatusColumn(tCol("status")),
      expenseAmountColumn(tCol("amount")),
    ],
    [tCol, tPayment, date],
  );

  return (
    <Card>
      <CardHeader
        title={t("mineTitle")}
        action={
          <Link
            href="/expenses"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current"
          >
            {t("allExpenses")}
            <IconChevronRight className="size-4" />
          </Link>
        }
      />
      <ClientDataTable
        columns={columns}
        rows={mine}
        controls={controls}
        searchPlaceholder={tList("searchPlaceholder")}
        rowKey={(e) => e.id}
        rowHref={(e) => `/expenses/${e.id}`}
        empty={tList("noMatch")}
      />
    </Card>
  );
}

// What a functionary who has never seen this app needs: not four zeroes, but
// the shape of the whole path and where their part of it ends. This doubles as
// the app's only help (there is no documentation anywhere else) which is why
// step four names the payout account, the thing that actually strands people.
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
                  not a feature list.
                  The four circles walk the brand ramp from pink to violet, so
                  the gradient is doing a job here rather than decorating: the
                  colour travels the same distance the utlägg does. color-mix
                  against the tokens rather than four fixed hexes, so the dark
                  theme's own endpoints apply. Every stop carries the near-black
                  label (worst 4.5:1 light, 6.7:1 dark). */}
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
