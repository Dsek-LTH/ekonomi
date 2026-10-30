"use client";

// What is left to set up before income can be fetched and booked, said on the
// page before anyone tries. See lib/income/setup.ts.
//
// Drawn in two places. On the Intäkter pages it ends with the way to the one
// settings page where all of it is done. On that settings page (`onPage`) each
// step instead points down the page at the section it is done in.
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Notice } from "@/components/ui/notice";
import type { IncomeSetupStep } from "@/lib/income/setup";

export function IncomeSetupNotice({
  steps,
  canSetUp,
  onPage = false,
}: {
  steps: IncomeSetupStep[];
  /** Holds Inställningar, so the steps link there. Otherwise they say who to ask. */
  canSetUp: boolean;
  /** Drawn on Inställningar → Försäljning itself. */
  onPage?: boolean;
}) {
  const t = useTranslations("income.setup");
  if (steps.length === 0) return null;
  // Booking needs more than fetching does. When only the booking steps are
  // left, fetching can already go ahead, and the heading says so.
  const fetchBlocked = steps.some((s) => s.blocksFetch);
  const inApp = steps.some((s) => s.inApp);
  return (
    <Notice>
      <p className="font-medium">{t(fetchBlocked ? "titleFetch" : "titleBook")}</p>
      <ol className="list-decimal space-y-1 pl-5">
        {steps.map((s, i) => (
          <li key={s.key}>
            {t(`steps.${s.key}`)}{" "}
            {/* Once per section, on the first step done there. The same link
                on three lines in a row read as three different places. */}
            {onPage && s.inApp && steps.findIndex((o) => o.section === s.section) === i && (
              <a href={`#${s.section}`} className="font-medium underline">
                {t(`goTo.${s.section}`)}
              </a>
            )}
          </li>
        ))}
      </ol>
      {!onPage && inApp && (
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
