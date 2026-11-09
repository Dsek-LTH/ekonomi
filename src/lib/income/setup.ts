// What is left to set up before income can be fetched and booked, shown up front on the Intäkter pages.

import "server-only";

import { incomeRoutingProblems, type IncomeConfigBlocker } from "@/lib/income/config";
import { zettleConfigured } from "@/lib/income/zettle-client";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";

/** Each a message key under `income.setup.steps`. */
export type IncomeSetupKey =
  "service" | IncomeConfigBlocker | "swishClearing" | "zettleClearing" | "zettleFee";

/** The parts of Inställningar → Försäljning, each an anchor on that page. */
export type IncomeSetupSection = "service" | "units" | "booking";

export interface IncomeSetupStep {
  key: IncomeSetupKey;
  /** Where on Inställningar → Försäljning it is done. */
  section: IncomeSetupSection;
  /** Refused by a fetch. The rest only stop booking, so fetching can go ahead. */
  blocksFetch: boolean;
  /** Done in the app, so there is somewhere to send the reader (Zettle's credentials are server environment). */
  inApp: boolean;
}

/** Every step still to do, in the order they are best done. Empty when ready. */
export async function incomeSetupSteps(): Promise<IncomeSetupStep[]> {
  const [routing, settings] = await Promise.all([
    incomeRoutingProblems(),
    loadBookkeepingSettings(),
  ]);
  const steps: IncomeSetupStep[] = [];

  // Zettle's credentials. Only a Zettle fetch needs them, so this does not block fetching.
  if (!zettleConfigured())
    steps.push({ key: "service", section: "service", blocksFetch: false, inApp: false });

  for (const p of routing) {
    steps.push({ key: p.blocker, section: "units", blocksFetch: true, inApp: true });
  }

  // What booking needs and fetching does not (see api/income/reports/[id]/book).
  const booking = (key: IncomeSetupKey): IncomeSetupStep => ({
    key,
    section: "booking",
    blocksFetch: false,
    inApp: true,
  });
  if (!settings.swishClearingAccount) steps.push(booking("swishClearing"));
  if (!settings.zettleClearingAccount) steps.push(booking("zettleClearing"));
  if (!settings.zettleFeeAccount) steps.push(booking("zettleFee"));

  return steps;
}
