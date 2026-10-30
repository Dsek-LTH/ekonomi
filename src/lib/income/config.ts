// The routing table, read from the settings an admin edits.
//
// intakt used to read all of this from a config.yaml on the treasurer's
// laptop, and later from a copy this file serialised into every request. Now
// nothing leaves the app: the rows are here, an admin edits them under
// Inställningar → Försäljning, and lib/income/routing.ts applies them.
import "server-only";

import { prisma } from "@/lib/server/db";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";
import type { Route, RoutingTable } from "./routing";

/**
 * Why a table could not be built. Each is a message key under
 * `errors.income`. The routing table is admin-editable, so these are all
 * states a person can put the app into and has to be told how to get out of.
 */
export type IncomeConfigBlocker = "noCommittees" | "noPrefixes" | "noFallback";

/** One thing in the way. */
export interface IncomeConfigProblem {
  blocker: IncomeConfigBlocker;
}

type RoutingResult = { ok: true; table: RoutingTable } | { ok: false; blocker: IncomeConfigBlocker };

/**
 * Everything wrong with the routing table, in the order it has to be fixed.
 *
 * Every problem rather than the first, so the Intäkter page can list what is
 * left to do before anyone fetches, instead of a fetch stopping at one of them
 * and leaving the next to be found by trying again.
 */
function routingProblems(committees: number, prefixes: number, fallback: Route | null): IncomeConfigProblem[] {
  const problems: IncomeConfigProblem[] = [];
  if (committees === 0) problems.push({ blocker: "noCommittees" });
  if (prefixes === 0) problems.push({ blocker: "noPrefixes" });
  // Without a reserv an unrecognised product has nowhere to go. It is a
  // setting with no default, so its absence refuses rather than guessing.
  if (!fallback) problems.push({ blocker: "noFallback" });
  return problems;
}

/**
 * The reserv as a route, or null when it is not set, or names a verksamhet
 * that has since stopped selling. Routing a sale to a retired verksamhet would
 * book takings to somebody who no longer takes any.
 */
async function loadFallback(): Promise<Route | null> {
  const settings = await loadBookkeepingSettings();
  if (!settings.incomeFallbackIncomeId || !settings.incomeFallbackAccount) return null;
  const income = await prisma.resultUnitIncome.findUnique({
    where: { id: settings.incomeFallbackIncomeId },
    select: { key: true, active: true },
  });
  return income?.active ? { key: income.key, account: settings.incomeFallbackAccount } : null;
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
  const [committees, prefixes, amountGuesses, accounts, fallback] = await Promise.all([
    prisma.resultUnitIncome.count({ where: { active: true } }),
    // Only prefixes of a verksamhet that still sells: retiring one is a
    // supported thing to do, and its prefixes then simply stop matching.
    prisma.incomeProductPrefix.findMany({
      where: { income: { active: true } },
      select: { code: true, account: true, income: { select: { key: true } } },
    }),
    prisma.swishAmountFallback.findMany(),
    prisma.account.findMany({ select: { number: true, name: true } }),
    loadFallback(),
  ]);

  const [problem] = routingProblems(committees, prefixes.length, fallback);
  if (problem || !fallback) return { ok: false, blocker: problem?.blocker ?? "noFallback" };

  return {
    ok: true,
    table: {
      prefixes: new Map(prefixes.map((p) => [p.code.toLowerCase(), { key: p.income.key, account: p.account }])),
      fallback,
      swishAmountGuesses: new Map(amountGuesses.map((g) => [g.amount, g.message])),
      accountNames: new Map(accounts.map((a) => [a.number, a.name])),
    },
  };
}
