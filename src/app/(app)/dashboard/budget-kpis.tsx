"use client";

// Four figures over whatever units the dashboard is reading: income, costs,
// the result, and what is left of the cost budget. The answer at a glance, so
// the table under it is where you go for the why.
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { totalOf, type OverviewUnit } from "@/lib/budget/overview";
import { cn } from "@/lib/ui/utils";
import { useMoney } from "./budget-overview-card";

export function BudgetKpis({ units }: { units: OverviewUnit[] }) {
  const t = useTranslations("dashboard.kpi");
  const money = useMoney();
  const { income, cost } = totalOf(units);
  const result = income.actual - cost.actual;
  const planned = income.budget - cost.budget;
  const left = cost.budget - cost.actual;
  const share = (actual: number, budget: number) =>
    budget > 0 ? t("share", { percent: Math.round((actual / budget) * 100) }) : t("unbudgeted");

  const tiles = [
    { label: t("income"), value: money(income.actual), note: share(income.actual, income.budget) },
    { label: t("cost"), value: money(cost.actual), note: share(cost.actual, cost.budget) },
    {
      label: t("result"),
      value: money(result),
      note: t("budgeted", { amount: money(planned) }),
      bad: result < 0,
    },
    {
      label: t("left"),
      value: money(left),
      note: cost.budget > 0 ? t("ofBudget", { amount: money(cost.budget) }) : t("unbudgeted"),
      bad: left < 0,
    },
  ];

  return (
    <Card>
      <dl className="grid grid-cols-2 divide-border md:grid-cols-4 md:divide-x">
        {tiles.map((tile, i) => (
          <div
            key={tile.label}
            className={cn("px-inset py-4", i < 2 && "border-b border-border md:border-b-0")}
          >
            <dt className="text-xs font-medium text-muted">{tile.label}</dt>
            <dd
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums tracking-[-0.01em]",
                tile.bad && "text-danger",
              )}
            >
              {tile.value}
            </dd>
            <dd className="mt-0.5 text-xs text-muted tabular-nums">{tile.note}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
