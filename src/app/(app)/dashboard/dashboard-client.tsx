"use client";

import { expensesHref } from "@/app/(app)/expenses/scope";
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
import { ScoreNumber } from "@/components/member-score";
import { formatSEK } from "@/lib/ui/format";
import { cn } from "@/lib/ui/utils";
import type { TodoBand, TodoGroup, TodoGroupKind, TodoItem, TodoKind } from "@/lib/domain/todo";
import type { UpcomingItem, WaitingOwn } from "@/lib/data/dashboard";

type Tone = React.ComponentProps<typeof Tag>["tone"];

const TODO_TONE: Record<TodoKind, Tone> = {
  fix: "danger",
  draft: "neutral",
  cardPurchase: "warning",
  attestExpense: "purple",
  attestInvoice: "purple",
  allocateInvoice: "purple",
  allocateDocument: "purple",
  bookInvoice: "accent",
  sendInvoice: "accent",
};

const TODO_HREF: Record<TodoKind, (id: string) => string> = {
  fix: (id) => `/expenses/${id}`,
  draft: (id) => `/expenses/${id}`,
  cardPurchase: (id) => `/expenses/new?txn=${id}`,
  attestExpense: (id) => `/expenses/${id}`,
  attestInvoice: (id) => `/invoices/${id}`,
  allocateInvoice: (id) => `/invoices/${id}/allocate`,
  allocateDocument: (id) => `/invoices/inbox/${id}`,
  bookInvoice: (id) => `/invoices/${id}/book`,
  sendInvoice: (id) => `/invoices/${id}`,
};

const GROUP_TONE: Record<TodoGroupKind, Tone> = {
  sortInbox: "neutral",
  bookExpenses: "accent",
  exportExpenses: "accent",
  cardless: "warning",
  overdueElsewhere: "danger",
  membersBehind: "warning",
};

const GROUP_HREF: Record<TodoGroupKind, string> = {
  sortInbox: "/invoices/inbox",
  bookExpenses: expensesHref("all", "book"),
  exportExpenses: expensesHref("all", "export"),
  cardless: "/bank",
  overdueElsewhere: "/invoices",
  membersBehind: "/profile/members",
};

const CALENDAR_HREF: Record<UpcomingItem["kind"], (id: string) => string> = {
  invoice: (id) => `/invoices/${id}`,
  pickup: (id) => `/contracts/${id}`,
  contractEnds: (id) => `/contracts/${id}`,
  stockEvent: (id) => `/stock/alcohol/events/${id}`,
};

/** Rows of Senare shown before "Visa fler". Late and this week's are always shown in full. */
const LATER_SHOWN = 5;

const WAITING_SHOWN = 6;

const CALENDAR_SHOWN = 6;

const BUDGET_SHOWN = 5;

/** Due this soon and the due label turns amber. */
const DUE_SOON_DAYS = 3;

const LINK =
  "inline-flex items-center gap-0.5 text-sm font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current";

export interface BudgetFlags {
  budgetId: string | null;
  scope: "all" | "own";
  ownCount: number;
  elapsed: number;
  units: { name: string | null; pace: "OVER" | "AHEAD" | "ON_TRACK"; used: number }[];
}

export function DashboardClient({
  firstName,
  payoutMissing,
  bands,
  groups,
  waiting,
  calendar,
  budget,
  fresh,
  score,
}: {
  firstName: string;
  payoutMissing: boolean;
  bands: { band: TodoBand; items: TodoItem[] }[];
  groups: TodoGroup[];
  waiting: WaitingOwn[];
  calendar: UpcomingItem[];
  budget: BudgetFlags | null;
  fresh: boolean;
  score: number | null;
}) {
  const t = useTranslations("dashboard");
  const empty = bands.length === 0 && groups.length === 0;

  return (
    <PageShell
      title={t("greeting", { name: firstName })}
      width="content"
      aside={
        <div className="max-md:hidden">
          <NewExpenseMenu size="sm" />
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <InstallHint />
        {payoutMissing && (
          <Link href="/profile" className="hover:underline">
            <Notice>{t("payoutMissing")}</Notice>
          </Link>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="grid items-start gap-6 lg:col-span-2">
            {fresh && empty ? (
              <FirstRun />
            ) : (
              <TodoCard bands={bands} groups={groups} score={score} />
            )}
          </div>
          <div className="grid items-start gap-6">
            {budget && <BudgetCard budget={budget} />}
            {waiting.length > 0 && <WaitingCard rows={waiting} />}
            {calendar.length > 0 && <CalendarCard items={calendar} />}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function TodoCard({
  bands,
  groups,
  score,
}: {
  bands: { band: TodoBand; items: TodoItem[] }[];
  groups: TodoGroup[];
  score: number | null;
}) {
  const t = useTranslations("dashboard.todo");
  const [allLater, setAllLater] = useState(false);

  return (
    <Card id="att-gora" data-tour="todo" className="scroll-mt-24">
      <CardHeader
        title={t("title")}
        action={
          <Link href="/profile" title={t("scoreTitle")} className="inline-flex">
            <ScoreNumber value={score} />
          </Link>
        }
      />
      {bands.length === 0 && groups.length === 0 ? (
        <EmptyNote>{t("empty")}</EmptyNote>
      ) : (
        <div className="py-2">
          {bands.map(({ band, items }) => {
            const shown = band === "later" && !allLater ? items.slice(0, LATER_SHOWN) : items;
            const more = items.length - shown.length;
            return (
              <Section key={band} title={t(`band.${band}`)} alert={band === "late"}>
                {shown.map((i) => (
                  <li key={`${i.kind}-${i.id}`}>
                    <TodoRow item={i} />
                  </li>
                ))}
                {more > 0 && (
                  <li className="px-2 pt-1">
                    <button type="button" onClick={() => setAllLater(true)} className={LINK}>
                      {t("showMore", { count: more })}
                    </button>
                  </li>
                )}
              </Section>
            );
          })}
          {groups.length > 0 && (
            <Section title={t("band.groups")}>
              {groups.map((g) => (
                <li key={g.kind}>
                  <Row href={GROUP_HREF[g.kind]}>
                    <CountTag tone={GROUP_TONE[g.kind]} count={g.count} />
                    <span className="min-w-0 flex-1">
                      {t(`group.${g.kind}`, { count: g.count })}
                    </span>
                  </Row>
                </li>
              ))}
            </Section>
          )}
        </div>
      )}
    </Card>
  );
}

function Section({
  title,
  alert = false,
  children,
}: {
  title: string;
  alert?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border px-2 py-2 first:border-t-0 first:pt-0">
      <h3 className={cn("px-2 py-1 text-xs font-medium", alert ? "text-danger" : "text-muted")}>
        {title}
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

function TodoRow({ item: i }: { item: TodoItem }) {
  const t = useTranslations("dashboard.todo");
  const context = t(`context.${i.kind}`, { who: i.who ?? "-" });
  return (
    <Row href={TODO_HREF[i.kind](i.id)}>
      <Tag tone={TODO_TONE[i.kind]} size="sm" className="w-20 shrink-0 justify-center">
        {t(`tag.${i.kind}`)}
      </Tag>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{i.title || t("untitled")}</span>
        <span className="block truncate text-xs text-muted">
          {i.amount != null ? `${context} - ${formatSEK(i.amount)}` : context}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 text-xs tabular-nums",
          i.inDays < 0 ? "text-danger" : i.inDays <= DUE_SOON_DAYS ? "text-warning" : "text-muted",
        )}
      >
        {i.inDays < 0
          ? t("due.late", { count: -i.inDays })
          : i.inDays === 0
            ? t("due.today")
            : t("due.in", { count: i.inDays })}
      </span>
    </Row>
  );
}

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

function CalendarCard({ items }: { items: UpcomingItem[] }) {
  const t = useTranslations("dashboard.calendar");
  const [all, setAll] = useState(false);
  const locale = useLocale();
  // Read them as UTC so no time zone moves them.
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
