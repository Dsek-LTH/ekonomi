"use client";

// What the section owes you, for the member who answers for no budget. Their
// own money is the figure they came for, so it is the one set large: the sum
// on its way back, and where it is on the way. See lib/data/my-money.ts for
// what counts and why "paid" is not a state this can show.
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import type { MyMoney } from "@/lib/data/my-money";
import { useMoney } from "./budget-overview-card";

export function MyMoneyCard({ money }: { money: MyMoney }) {
  const t = useTranslations("dashboard.money");
  const fmt = useMoney();
  const onItsWay = money.awaitingAttest.amount + money.approved.amount;

  const stages = [
    { key: "awaitingAttest", stage: money.awaitingAttest },
    { key: "approved", stage: money.approved },
    { key: "exportedThisYear", stage: money.exportedThisYear },
  ] as const;

  return (
    <Card>
      <div className="px-inset py-5">
        <p className="text-sm text-muted">{t("onItsWayLabel")}</p>
        <p className="mt-1 text-[32px] font-semibold leading-none tracking-[-0.026em] tabular-nums">
          {fmt(onItsWay)}
        </p>
        {onItsWay === 0 && <p className="mt-2 text-sm text-muted">{t("nothingOwed")}</p>}
      </div>
      <dl className="grid grid-cols-3 divide-x divide-border border-t border-border">
        {stages.map(({ key, stage }) => (
          <div key={key} className="px-inset py-3">
            <dt className="text-xs font-medium text-muted">{t(`stage.${key}`)}</dt>
            <dd className="mt-1 font-medium tabular-nums">{fmt(stage.amount)}</dd>
            <dd className="text-xs text-muted tabular-nums">
              {t("count", { count: stage.count })}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
