// Imports the real budget from prisma/import/budget-2026.json (produced by
// parse-budget.py) as two standalone budgets for the year — the workbook's two
// value columns, both named by the workbook itself (Parametrar!I5 and I6):
//
//   "2026 DELTA" — the left-hand column, the revision being written
//   "2026 VTM"   — the column it was revised from
//
// Both are imported only because both reconcile against the totals the sheets
// themselves report; parse-budget.py refuses to leave that unsaid. An earlier
// workbook's previous column did not add up, and importing it would have put a
// budget in the app that disagreed with the budget that was voted through — so
// if that check ever fails again, drop the column rather than importing it.
//
// Re-runnable: drops and recreates every budget of the year. Pass a name to
// override the imported column's name — `tsx prisma/import/import-budget.ts VTM`.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/lib/generated/prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadEnvFile } from "../load-env";

loadEnvFile();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface ValueRep { quantity: string | null; unitPrice: string | null; expression: string }
interface JsonLineItem { description: string; rev: ValueRep; orig: ValueRep }
interface JsonAccount { code: string; name: string; lineItems: JsonLineItem[] }
// `resultUnit` is carried through from the spreadsheet's Rambudget headings and
// read by nobody here, on purpose: which result unit a cost centre belongs to is
// derived from its code prefix at read time (lib/server/result-units.ts), never
// stored on the cost centre. It stays in the JSON because it is what the
// spreadsheet said, and that is worth being able to check the prefixes against.
interface JsonCostCenter { code: string; name: string; resultUnit: string | null; accounts: JsonAccount[] }
interface JsonVariable { name: string; rev: string; orig: string }
interface BudgetJson {
  year: number;
  name: string;         // the imported column, e.g. "2026 DELTA"
  previousName: string; // the column it was revised from, e.g. "2026 VTM"
  variables: JsonVariable[];
  costCenters: JsonCostCenter[];
}

async function main() {
  const data: BudgetJson = JSON.parse(
    readFileSync(join(__dirname, "budget-2026.json"), "utf-8"),
  );

  const admin =
    (await prisma.user.findFirst({ where: { roles: { hasSome: ["SKATTMASTARE", "ORDFORANDE"] } } })) ??
    (await prisma.user.findFirst());
  if (!admin) throw new Error("No user to own the budget — seed the database first.");

  // 1. Upsert a cost center per result unit sheet.
  const ccByCode = new Map<string, string>(); // code → CostCenter.id
  for (const cc of data.costCenters) {
    // ResultUnit membership is derived from code prefixes (see lib/result units),
    // so nothing about it is written here — the sheet's result unit column is
    // informational only.
    const row = await prisma.costCenter.upsert({
      where: { code: cc.code },
      update: { name: cc.name },
      create: { code: cc.code, name: cc.name },
    });
    ccByCode.set(cc.code, row.id);
  }

  // 2. Build a budget from one side (rev | orig) of the parsed data.
  async function buildBudget(name: string, side: "rev" | "orig") {
    const budget = await prisma.budget.create({
      data: {
        year: data.year,
        name,
        createdById: admin!.id,
        variables: {
          create: data.variables.map((v, i) => ({
            name: v.name,
            expression: side === "rev" ? v.rev : v.orig,
            sortOrder: i,
          })),
        },
      },
    });

    for (const [ci, cc] of data.costCenters.entries()) {
      await prisma.budgetCostCenter.create({
        data: {
          budgetId: budget.id,
          costCenterId: ccByCode.get(cc.code)!,
          sortOrder: ci,
          accounts: {
            create: cc.accounts.map((a, ai) => ({
              accountCode: a.code,
              accountName: a.name,
              sortOrder: ai,
              lineItems: {
                create: a.lineItems.map((li, li_i) => {
                  const v = li[side];
                  // Store the live equation in Belopp for antal × á-pris rows, so
                  // changing a variable reflows the amount. Otherwise the literal.
                  const expression =
                    v.quantity?.trim() && v.unitPrice?.trim()
                      ? `=${v.quantity.trim()}*${v.unitPrice.trim()}`
                      : v.expression;
                  return {
                    description: li.description,
                    quantity: v.quantity,
                    unitPrice: v.unitPrice,
                    expression,
                    sortOrder: li_i,
                  };
                }),
              },
            })),
          },
        },
      });
    }
    return budget;
  }

  // Budgets stand alone, so "replace the year's budget" means every budget of
  // that year — there is no container row to hold them together any more.
  const name = process.argv[2]?.trim() || data.name;
  await prisma.budget.deleteMany({ where: { year: data.year } });
  // The previous column first, so the newer revision sorts after it.
  await buildBudget(data.previousName, "orig");
  await buildBudget(name, "rev");

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
