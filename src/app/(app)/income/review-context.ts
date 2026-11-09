// Everything the review view needs besides the days themselves.
//
// Kept apart from the page so the settings, the pickers and the verksamheter a
// sale can be given to are worked out in one place.
import "server-only";

import { getActiveAccounts } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getActiveProjects } from "@/lib/data/projects";
import {
  getIncomeMoveTargets,
  type IncomeMoveTarget,
  type IncomeReportRow,
} from "@/lib/data/income";
import { getIncomeSettings, type IncomeSettingsRow } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter, ProjectRecord } from "@/lib/domain/types";
import { prisma } from "@/lib/server/db";

interface IncomeReviewContext {
  settings: IncomeSettingsRow;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  moveTargets: IncomeMoveTarget[];
  /** Fortnox projects, which a hand-written kontering may name. */
  projects: ProjectRecord[];
  /**
   * The verksamhet sales matching no prefix are routed to, as a result unit.
   * Its days hold whatever the routing could not place, which is what a
   * reviewer most needs to look at on them. Null while no reserv is set.
   */
  fallbackResultUnitId: string | null;
}

/**
 * The pickers offer active accounts and cost centres, plus whatever the days in
 * front of you already point at. Retiring a cost centre must not strand
 * takings already assigned to it, nor a clearing account still in use.
 */
export async function loadReviewContext(
  reports: readonly IncomeReportRow[],
): Promise<IncomeReviewContext> {
  // The move targets are the verksamheter still taking money in, where a sale
  // that was rung up without its prefix, and so landed in the fallback, can be
  // put back (lib/income/lines.ts).
  const [settings, moveTargets] = await Promise.all([getIncomeSettings(), getIncomeMoveTargets()]);

  const [costCenters, accounts, projects] = await Promise.all([
    // Whatever the lines already point at counts too, retired or not: a line
    // on a cost centre that has since been archived must still show its code,
    // so the reviewer can see why the day will not book and give it another.
    getActiveCostCenters(
      reports.flatMap((d) => [
        ...d.lines.flatMap((l) => (l.costCenterCode ? [l.costCenterCode] : [])),
        ...(d.manual?.rows.flatMap((r) => (r.costCenterCode ? [r.costCenterCode] : [])) ?? []),
      ]),
    ),
    getActiveAccounts([
      settings.zettleClearingAccount,
      settings.swishClearingAccount,
      settings.zettleFeeAccount,
      ...reports.flatMap((d) => d.lines.map((l) => l.account)),
      ...reports.flatMap((d) => d.manual?.rows.map((r) => r.account) ?? []),
    ]),
    getActiveProjects(),
  ]);

  const fallback = settings.incomeFallbackIncomeId
    ? await prisma.resultUnitIncome.findUnique({
        where: { id: settings.incomeFallbackIncomeId },
        select: { resultUnitId: true },
      })
    : null;

  return {
    settings,
    costCenters,
    accounts,
    projects,
    moveTargets,
    fallbackResultUnitId: fallback?.resultUnitId ?? null,
  };
}
