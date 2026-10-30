// What is left to set up before income can be fetched and booked, as a list of
// steps for the Intäkter pages to show up front.
//
// Each of these used to surface only as the refusal of the request that needed
// it: a fetch answered "Inga verksamheter är uppsatta", and once that was fixed
// the next fetch answered with the next missing piece. Asked here, before
// anyone tries, the page can say everything that is left in one go, and all of
// it is done in one place: Inställningar → Försäljning.
import "server-only";

import { incomeRoutingProblems, type IncomeConfigBlocker } from "@/lib/income/config";
import { intaktConfigured } from "@/lib/income/client";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";

/** Each a message key under `income.setup.steps`. */
export type IncomeSetupKey =
  | "service"
  | IncomeConfigBlocker
  | "swishClearing"
  | "zettleClearing"
  | "zettleFee";

/** The parts of Inställningar → Försäljning, each an anchor on that page. */
export type IncomeSetupSection = "service" | "units" | "booking";

export interface IncomeSetupStep {
  key: IncomeSetupKey;
  /** Where on Inställningar → Försäljning it is done. */
  section: IncomeSetupSection;
  /** Refused by a fetch. The rest only stop booking, so fetching can go ahead. */
  blocksFetch: boolean;
  /** Done in the app, so there is somewhere to send the reader. The service is
   *  set in the server's environment, and only said. */
  inApp: boolean;
}

/** Every step still to do, in the order they are best done. Empty when ready. */
export async function incomeSetupSteps(): Promise<IncomeSetupStep[]> {
  const [routing, settings] = await Promise.all([incomeRoutingProblems(), loadBookkeepingSettings()]);
  const steps: IncomeSetupStep[] = [];

  // The service that reaches Zettle and renders the intäktsräkning.
  if (!intaktConfigured()) steps.push({ key: "service", section: "service", blocksFetch: true, inApp: false });

  for (const p of routing) {
    steps.push({ key: p.blocker, section: "units", blocksFetch: true, inApp: true });
  }

  // What booking needs and fetching does not (see api/income/reports/[id]/book).
  const booking = (key: IncomeSetupKey): IncomeSetupStep => ({ key, section: "booking", blocksFetch: false, inApp: true });
  if (!settings.swishClearingAccount) steps.push(booking("swishClearing"));
  if (!settings.zettleClearingAccount) steps.push(booking("zettleClearing"));
  if (!settings.zettleFeeAccount) steps.push(booking("zettleFee"));

  return steps;
}
