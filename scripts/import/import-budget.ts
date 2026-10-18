// Imports the real budget from scripts/import/budget-2026.json (produced by
// parse-budget.py) as two standalone budgets for the year: the workbook's two
// value columns, both named by the workbook itself (Parametrar!I5 and I6):
//
//   "2026 DELTA": the left-hand column, the revision being written
//   "2026 VTM"   the column it was revised from
//
// Both are imported only because both reconcile against the totals the sheets
// themselves report; parse-budget.py refuses to leave that unsaid. An earlier
// workbook's previous column did not add up, and importing it would have put a
// budget in the app that disagreed with the budget that was voted through, so
// if that check ever fails again, drop the column rather than importing it.
//
// Re-runnable: drops and recreates every budget of the year. Pass a name to
// override the imported column's name: `tsx scripts/import/import-budget.ts VTM`.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/lib/generated/prisma/client";

import { loadEnvFile } from "../load-env";
import { buildBudget, loadBudgetJson } from "./budget-json";

loadEnvFile();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const data = loadBudgetJson();

  const admin =
    (await prisma.user.findFirst({ where: { roles: { hasSome: ["SKATTMASTARE", "ORDFORANDE"] } } })) ??
    (await prisma.user.findFirst());
  if (!admin) throw new Error("No user to own the budget, seed the database first.");

  // 1. Upsert a cost center per result unit sheet.
  const ccByCode = new Map<string, string>(); // code → CostCenter.id
  for (const cc of data.costCenters) {
    // ResultUnit membership is derived from code prefixes (see lib/result units),
    // so nothing about it is written here. The sheet's result unit column is
    // informational only.
    // Created local. The sheet has cost centres Fortnox does not (the alko
    // ones), and a code Fortnox does not have must never be sent to it. The
    // next Fortnox sync takes over every code Fortnox does have.
    const row = await prisma.costCenter.upsert({
      where: { code: cc.code },
      update: { name: cc.name },
      create: { code: cc.code, name: cc.name, source: "LOCAL" },
    });
    ccByCode.set(cc.code, row.id);
  }

  // Budgets stand alone, so "replace the year's budget" means every budget of
  // that year, there is no container row to hold them together any more.
  const name = process.argv[2]?.trim() || data.name;
  await prisma.budget.deleteMany({ where: { year: data.year } });
  // The previous column first, so the newer revision sorts after it.
  const base = { createdById: admin.id, costCenterIds: ccByCode };
  await buildBudget(prisma, data, { ...base, name: data.previousName, side: "orig" });
  await buildBudget(prisma, data, { ...base, name, side: "rev" });

  const accounts = data.costCenters.reduce((s, c) => s + c.accounts.length, 0);
  const lines = data.costCenters.reduce((s, c) => s + c.accounts.reduce((t, a) => t + a.lineItems.length, 0), 0);
  console.log(
    `Imported ${data.year} "${data.previousName}" and "${name}": ` +
    `${data.costCenters.length} cost centers, ${accounts} accounts, ${lines} line items, ` +
    `${data.variables.length} variables each.`,
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
