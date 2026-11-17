"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Notice } from "@/components/ui/notice";
import type { IncomeSetupStep } from "@/lib/income/setup";

export function IncomeSetupNotice({
  steps,
  canSetUp,
}: {
  steps: IncomeSetupStep[];
  canSetUp: boolean;
}) {
  const t = useTranslations("income.setup");
  if (steps.length === 0) return null;
  // Booking needs more than fetching: with only booking steps left, fetching can go ahead and the heading says so.
  const fetchBlocked = steps.some((s) => s.blocksFetch);
  const inApp = steps.some((s) => s.inApp);
  return (
    <Notice>
      <p className="font-medium">{t(fetchBlocked ? "titleFetch" : "titleBook")}</p>
      <ol className="list-decimal space-y-1 pl-5">
        {steps.map((s) => (
          <li key={s.key}>{t(`steps.${s.key}`)}</li>
        ))}
      </ol>
      {inApp && (
        <p>
          {canSetUp ? (
            <Link href="/admin/income" className="font-medium underline">
              {t("openSettings")}
            </Link>
          ) : (
            <span className="text-muted">{t("askAdmin")}</span>
          )}
        </p>
      )}
    </Notice>
  );
}
