"use client";

// The year so far, on the dashboard: every result unit, its income and costs
// against the budget, and the cost centres under it.
//
// It is here because members did not know the budget and its utfall existed.
// The pages for them were two links in a menu group most people never opened,
// so the answer to "how is our money doing" now comes to them instead.
//
// One unit per row, folded. The viewer's own units come first and open, since
// that is the question they most likely came with. Each carries a tag for how
// its costs are keeping up with the year, so nobody has to do that sum.
//
// `only` narrows it to some units (an utskottsmästare's own), and then every
// one of them opens: there are few, and they are the whole of the card.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyNote } from "@/components/ui/empty-state";
import { Tag } from "@/components/ui/status-pill";
import { IconChevronDown, IconChevronRight } from "@/components/ui/icons";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import {
  paceOf,
  type BudgetFigure,
  type OverviewCostCenter,
  type OverviewUnit,
  type Pace,
} from "@/lib/budget/overview";
import type { BudgetOverview } from "@/lib/data/budget-overview";

const PACE_TONE: Record<Pace, React.ComponentProps<typeof Tag>["tone"]> = {
  OVER: "danger",
  AHEAD: "warning",
  ON_TRACK: "success",
};

export function BudgetOverviewCard({
  overview,
  ownUnits,
  yearElapsed,
  only,
}: {
  overview: BudgetOverview;
  /** The result units the viewer answers for, by name. */
  ownUnits: string[];
  /** How much of the year has gone, 0 to 1. From the server, so it hydrates. */
  yearElapsed: number;
  /** Show only these units, by name, all of them open. */
  only?: string[];
}) {
  const t = useTranslations("dashboard.budget");
  const { dateTime } = useFormat();
  const money = useMoney();

  const units = useMemo(
    () =>
      overview.units
        .filter((u) => !only || (u.name !== null && only.includes(u.name)))
        .sort((a, b) => Number(isOwn(b, ownUnits)) - Number(isOwn(a, ownUnits))),
    [overview.units, ownUnits, only],
  );
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(units.filter((u) => only || isOwn(u, ownUnits)).map(unitKey)),
  );
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const subtitle = overview.budget
    ? t("subtitle", {
        budget: `${overview.year} - ${overview.budget.name}`,
        synced: overview.lastSyncAt ? dateTime(overview.lastSyncAt) : t("neverSynced"),
      })
    : undefined;

  return (
    <Card>
      <CardHeader
        title={only ? t("titleOwn", { year: overview.year }) : t("title", { year: overview.year })}
        subtitle={subtitle}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {overview.budget && (
              <HeaderLink href={`/budget/${overview.budget.id}`}>{t("openBudget")}</HeaderLink>
            )}
            <HeaderLink href="/ledger">{t("openReports")}</HeaderLink>
          </div>
        }
      />
      {units.length === 0 ? (
        <EmptyNote>{overview.budget ? t("emptyNoData") : t("emptyNoBudget")}</EmptyNote>
      ) : (
        <>
          {/* Column heads, for the wide layout only. On a phone each figure
              carries its own label instead. */}
          <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-x-6 border-b border-border px-inset py-2 text-xs font-medium text-muted md:grid">
            <span>{t("colUnit")}</span>
            <span>{t("colIncome")}</span>
            <span>{t("colCost")}</span>
            <span className="text-right">{t("colResult")}</span>
          </div>
          <ul className="divide-y divide-border">
            {units.map((u) => {
              const key = unitKey(u);
              const expanded = open.has(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    aria-expanded={expanded}
                    className="w-full text-left hover:bg-hover"
                  >
                    <FigureRow
                      label={
                        <span className="flex min-w-0 items-center gap-2 font-semibold">
                          {expanded ? (
                            <IconChevronDown className="size-4 shrink-0 text-muted" />
                          ) : (
                            <IconChevronRight className="size-4 shrink-0 text-muted" />
                          )}
                          <span className="break-words">{u.name ?? t("noUnit")}</span>
                          {!only && isOwn(u, ownUnits) && (
                            <Tag tone="accent" size="sm" className="shrink-0">
                              {t("yours")}
                            </Tag>
                          )}
                          <PaceTag pace={paceOf(u.cost, yearElapsed)} />
                        </span>
                      }
                      row={u}
                      money={money}
                      yearElapsed={yearElapsed}
                    />
                  </button>
                  {expanded && (
                    <ul className="border-t border-border bg-canvas">
                      {u.costCenters.map((cc) => (
                        <li key={cc.code} className="border-b border-border last:border-b-0">
                          <FigureRow
                            label={<CostCenterLabel cc={cc} />}
                            row={cc}
                            money={money}
                            yearElapsed={yearElapsed}
                            nested
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="flex items-center gap-2 border-t border-border px-inset py-3 text-xs text-muted">
            <span aria-hidden className="inline-block h-3 w-0.5 rounded-full bg-foreground/60" />
            {t("yearMarker", { percent: Math.round(yearElapsed * 100) })}
          </p>
        </>
      )}
    </Card>
  );
}

function PaceTag({ pace }: { pace: Pace | null }) {
  const t = useTranslations("dashboard.budget.pace");
  if (!pace) return null;
  return (
    <Tag tone={PACE_TONE[pace]} size="sm" className="shrink-0" title={t(`hint.${pace}`)}>
      {t(pace)}
    </Tag>
  );
}

const isOwn = (u: OverviewUnit, own: string[]) => u.name !== null && own.includes(u.name);
const unitKey = (u: OverviewUnit) => u.name ?? "";

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
    >
      {children}
      <IconChevronRight className="size-4" />
    </Link>
  );
}

function CostCenterLabel({ cc }: { cc: OverviewCostCenter }) {
  const t = useTranslations("dashboard.budget");
  if (!cc.code) return <span className="text-muted">{t("noCostCenter")}</span>;
  return (
    <span className="min-w-0 break-words">
      <span className="font-medium tabular-nums">{cc.code}</span>
      {cc.name && <span className="text-muted"> - {cc.name}</span>}
    </span>
  );
}

export type Money = (sek: number) => string;

// Whole kronor. A budget is planned in them, and öre on a year's totals are
// noise that makes every figure two characters wider.
export function useMoney(): Money {
  const locale = useLocale();
  return useMemo(() => {
    const f = new Intl.NumberFormat(locale === "en" ? "en-SE" : "sv-SE", {
      style: "currency",
      currency: "SEK",
      maximumFractionDigits: 0,
    });
    return (sek: number) => f.format(Math.round(sek));
  }, [locale]);
}

function FigureRow({
  label,
  row,
  money,
  yearElapsed,
  nested = false,
}: {
  label: React.ReactNode;
  row: { income: BudgetFigure; cost: BudgetFigure };
  money: Money;
  yearElapsed: number;
  nested?: boolean;
}) {
  const t = useTranslations("dashboard.budget");
  const result = row.income.actual - row.cost.actual;
  const planned = row.income.budget - row.cost.budget;
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-3 px-inset py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] md:items-center",
        nested && "md:pl-12",
      )}
    >
      <div className="col-span-2 min-w-0 text-sm md:col-span-1">{label}</div>
      <Meter
        label={t("colIncome")}
        figure={row.income}
        money={money}
        yearElapsed={yearElapsed}
        overIsBad={false}
      />
      <Meter
        label={t("colCost")}
        figure={row.cost}
        money={money}
        yearElapsed={yearElapsed}
        overIsBad
      />
      <div className="col-span-2 text-sm md:col-span-1 md:text-right">
        <span className="text-xs text-muted md:hidden">{t("colResult")}: </span>
        <span
          className={cn(
            "font-medium tabular-nums",
            result < 0 ? "text-danger" : "text-foreground",
          )}
        >
          {money(result)}
        </span>
        <div className="text-xs text-muted tabular-nums">
          {t("budgeted", { amount: money(planned) })}
        </div>
      </div>
    </div>
  );
}

/**
 * Booked against budgeted, as a bar with the share of the year that has gone
 * marked on it. The bar alone says "most of it is spent", the marker says
 * whether that is early. Text carries the figures, so the bar never has to be
 * read for a number.
 */
function Meter({
  label,
  figure,
  money,
  yearElapsed,
  overIsBad,
}: {
  label: string;
  figure: BudgetFigure;
  money: Money;
  yearElapsed: number;
  /** Costs past their budget are a problem. Income past it is not. */
  overIsBad: boolean;
}) {
  const t = useTranslations("dashboard.budget");
  const { budget, actual } = figure;
  if (!budget && !actual) {
    return (
      <div className="text-sm text-faint">
        <span className="text-xs md:hidden">{label}: </span>-
      </div>
    );
  }
  const share = budget > 0 ? actual / budget : null;
  const over = share !== null && share > 1;
  const alarm = over && overIsBad;
  return (
    <div className="min-w-0 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-1 tabular-nums">
        <span className="text-xs text-muted md:hidden">{label}: </span>
        <span className="font-medium">{money(actual)}</span>
        <span className="text-xs text-muted">
          {budget ? t("of", { amount: money(budget) }) : t("unbudgeted")}
        </span>
      </div>
      {share !== null && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={Math.round(budget)}
          aria-valuenow={Math.round(Math.max(actual, 0))}
          aria-valuetext={t("of", { amount: money(budget) })}
          className="relative mt-1.5 h-1.5 rounded-full bg-surface"
        >
          <div
            className={cn("h-full rounded-full", alarm ? "bg-danger" : "bg-accent")}
            style={{ width: `${Math.min(Math.max(share, 0), 1) * 100}%` }}
          />
          <span
            aria-hidden
            className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-foreground/60"
            style={{ left: `calc(${yearElapsed * 100}% - 1px)` }}
          />
        </div>
      )}
      {alarm && (
        <div className="mt-1 text-xs font-medium text-danger tabular-nums">
          {t("over", { amount: money(actual - budget) })}
        </div>
      )}
    </div>
  );
}
