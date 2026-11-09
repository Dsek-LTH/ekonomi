// The routing table, read from the settings an admin edits (applied by lib/income/routing.ts).

import "server-only";

import { prisma } from "@/lib/server/db";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";
import type { FeeRoute, Route, RoutingTable } from "./routing";

/** Why a table could not be built. Each is a message key under `errors.income`. */
export type IncomeConfigBlocker = "noCommittees" | "noPrefixes" | "noFallback";

/** One thing in the way. */
export interface IncomeConfigProblem {
  blocker: IncomeConfigBlocker;
}

type RoutingResult =
  { ok: true; table: RoutingTable } | { ok: false; blocker: IncomeConfigBlocker };

/** Every problem rather than the first, so the Intäkter page lists what is left before a fetch. */
function routingProblems(
  committees: number,
  prefixes: number,
  fallback: Route | null,
): IncomeConfigProblem[] {
  const problems: IncomeConfigProblem[] = [];
  if (committees === 0) problems.push({ blocker: "noCommittees" });
  if (prefixes === 0) problems.push({ blocker: "noPrefixes" });
  // Without a reserv an unrecognised product has nowhere to go.
  if (!fallback) problems.push({ blocker: "noFallback" });
  return problems;
}

/** The reserv as a route, or null when unset or naming a retired verksamhet. */
async function loadFallback(): Promise<Route | null> {
  const settings = await loadBookkeepingSettings();
  if (!settings.incomeFallbackIncomeId || !settings.incomeFallbackAccount) return null;
  const income = await prisma.resultUnitIncome.findUnique({
    where: { id: settings.incomeFallbackIncomeId },
    select: { key: true, active: true, defaultCostCenterId: true },
  });
  return income?.active
    ? {
        key: income.key,
        account: settings.incomeFallbackAccount,
        costCenterId: income.defaultCostCenterId,
      }
    : null;
}

/** Where Zettle's fees book. Either half may be unset: the day imports, booking refuses. */
export async function loadFeeRoute(): Promise<FeeRoute> {
  const settings = await loadBookkeepingSettings();
  return {
    account: settings.zettleFeeAccount ?? "",
    costCenterId: settings.zettleFeeCostCenterId,
  };
}

/** What stands between the routing table and a fetch. Empty when nothing does. */
export async function incomeRoutingProblems(): Promise<IncomeConfigProblem[]> {
  const [committees, prefixes, fallback] = await Promise.all([
    prisma.resultUnitIncome.count({ where: { active: true } }),
    prisma.incomeProductPrefix.count({ where: { income: { active: true } } }),
    loadFallback(),
  ]);
  return routingProblems(committees, prefixes, fallback);
}

/** The table a fetch routes by, or the first thing that stops one. */
export async function loadRoutingTable(): Promise<RoutingResult> {
  const [committees, prefixes, amountGuesses, fallback] = await Promise.all([
    prisma.resultUnitIncome.count({ where: { active: true } }),
    // Only prefixes of a verksamhet that still sells.
    prisma.incomeProductPrefix.findMany({
      where: { income: { active: true } },
      select: {
        code: true,
        account: true,
        costCenterId: true,
        income: { select: { key: true, defaultCostCenterId: true } },
      },
    }),
    prisma.swishAmountFallback.findMany(),
    loadFallback(),
  ]);

  const [problem] = routingProblems(committees, prefixes.length, fallback);
  if (problem || !fallback) return { ok: false, blocker: problem?.blocker ?? "noFallback" };

  return {
    ok: true,
    table: {
      prefixes: new Map(
        prefixes.map((p) => [
          p.code.toLowerCase(),
          {
            key: p.income.key,
            account: p.account,
            // The prefix's own, else its verksamhet's.
            costCenterId: p.costCenterId ?? p.income.defaultCostCenterId,
          },
        ]),
      ),
      fallback,
      swishAmountGuesses: new Map(amountGuesses.map((g) => [g.amount, g.message])),
    },
  };
}
