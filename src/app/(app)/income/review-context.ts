// Everything the review view needs besides the days themselves.
//
// Two pages render that view — the queue a fetch produced, and one reopened day
// on its own — and they have to hand it the same settings, the same pickers and
// the same move targets. Working that out twice is how two screens end up
// disagreeing about which cost centres exist.
import "server-only";

import { getActiveAccounts } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getIncomeMoveTargets, type IncomeMoveTarget, type IncomeReportRow } from "@/lib/data/income";
import { getIncomeSettings, type IncomeSettingsRow } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";

export interface IncomeReviewContext {
  settings: IncomeSettingsRow;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  moveTargets: IncomeMoveTarget[];
}

/**
 * The pickers offer active accounts and cost centres, plus whatever the days in
 * front of you already point at — retiring a cost centre must not strand
 * takings already assigned to it, nor a clearing account still in use.
 */
export async function loadReviewContext(
  reports: readonly IncomeReportRow[],
): Promise<IncomeReviewContext> {
  // The move targets are the verksamheter still taking money in — where a sale
  // that was rung up without its prefix, and so landed in the fallback, can be
  // put back (lib/income/lines.ts).
  const [settings, moveTargets] = await Promise.all([getIncomeSettings(), getIncomeMoveTargets()]);

  const [costCenters, accounts] = await Promise.all([
    getActiveCostCenters([
      ...reports.flatMap((d) => (d.costCenterCode ? [d.costCenterCode] : [])),
      // The defaults the booking screen pre-fills from count too: a committee
      // whose default has since been retired would otherwise pre-fill a code
      // the picker cannot show, which reads as no cost centre at all.
      ...reports.flatMap((d) => (d.defaultCostCenterCode ? [d.defaultCostCenterCode] : [])),
      ...(settings.zettleFeeCostCenterCode ? [settings.zettleFeeCostCenterCode] : []),
    ]),
    getActiveAccounts([
      settings.zettleClearingAccount,
      settings.swishClearingAccount,
      settings.zettleFeeAccount,
      ...reports.flatMap((d) => d.lines.map((l) => l.account)),
    ]),
  ]);

  return { settings, costCenters, accounts, moveTargets };
}
