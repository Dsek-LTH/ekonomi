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
  projects: ProjectRecord[];
  /** The verksamhet that sales matching no prefix are routed to, as a result unit. Null while no reserv is set. */
  fallbackResultUnitId: string | null;
}

/** The pickers offer active accounts and cost centres plus whatever the days in front already point at, so retiring one does not strand assigned takings. */
export async function loadReviewContext(
  reports: readonly IncomeReportRow[],
): Promise<IncomeReviewContext> {
  // The move targets are the verksamheter still taking money in (lib/income/lines.ts).
  const [settings, moveTargets] = await Promise.all([getIncomeSettings(), getIncomeMoveTargets()]);

  const [costCenters, accounts, projects] = await Promise.all([
    // Whatever the lines point at counts, retired or not, so the reviewer can see why the day will not book.
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
