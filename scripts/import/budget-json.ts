// The parsed budget workbook (budget-2026.json, from parse-budget.py), and
// the one way it becomes budgets in the database. Shared by the importer
// (import-budget.ts) and the dev seed (prisma/seed.ts), so a seeded budget is
// built exactly the way an imported one is.
//
// The JSON is parsed from VTM-EXTRA.xlsx. See parse-budget.py.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "../../src/lib/generated/prisma/client";

export interface ValueRep { quantity: string | null; unitPrice: string | null; expression: string }
export interface JsonLineItem { description: string; rev: ValueRep; orig: ValueRep }
export interface JsonAccount { code: string; name: string; lineItems: JsonLineItem[] }
// `resultUnit` is carried through from the spreadsheet's Rambudget headings and
// read by nobody here, on purpose: which result unit a cost centre belongs to is
// derived from its code prefix at read time (lib/server/result-units.ts), never
// stored on the cost centre. It stays in the JSON because it is what the
// spreadsheet said, and that is worth being able to check the prefixes against.
export interface JsonCostCenter { code: string; name: string; resultUnit: string | null; accounts: JsonAccount[] }
export interface JsonVariable { name: string; rev: string; orig: string }
export interface BudgetJson {
  year: number;
  name: string;         // the imported column, e.g. "2026 DELTA"
  previousName: string; // the column it was revised from, e.g. "2026 VTM"
  variables: JsonVariable[];
  costCenters: JsonCostCenter[];
}


export function loadBudgetJson(): BudgetJson {
  return JSON.parse(readFileSync(join(__dirname, "budget-2026.json"), "utf-8"));
}

/**
 * One budget from one side of the parsed workbook: `rev`, the column being
 * written, or `orig`, the column it was revised from. `costCenterIds` maps
 * every code in the JSON to its CostCenter row.
 */
export async function buildBudget(
  prisma: PrismaClient,
  data: BudgetJson,
  opts: {
    name: string;
    side: "rev" | "orig";
    createdById: string;
    costCenterIds: ReadonlyMap<string, string>;
    /** Sealed, as the section seals the budget it adopted. */
    lockedAt?: Date;
  },
) {
  const { name, side, createdById, costCenterIds, lockedAt } = opts;
  const budget = await prisma.budget.create({
    data: {
      year: data.year,
      name,
      createdById,
      lockedAt: lockedAt ?? null,
      lockedById: lockedAt ? createdById : null,
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
        costCenterId: costCenterIds.get(cc.code)!,
        sortOrder: ci,
        accounts: {
          create: cc.accounts.map((a) => ({
            accountCode: a.code,
            accountName: a.name,
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
