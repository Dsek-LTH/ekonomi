// Deep-copying a budget or a single cost centre; both use the same copy + repoint pair.
// A cell reference is bound to a line item id (`@L<id>:<field>`, see lib/budget/grid.ts), so a verbatim copy
// would point at the source rows. Each copy keeps old id to new id and rewrites the references it owns;
// a reference to a row that wasn't copied is left alone.
import { randomUUID } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma/client";
import { lockForAppend, nextSortOrder } from "@/lib/server/sort-order";
import { sheetName } from "@/lib/budget";
import { changeLabel, isActive } from "@/lib/budget/changes";

type SourceAccount = {
  accountCode: string;
  accountName: string;
  lineItems: {
    id: string;
    description: string;
    expression: string;
    quantity: string | null;
    unitPrice: string | null;
    sortOrder: number;
    values: Prisma.JsonValue;
  }[];
  // Editorial adjustments in force, copied as ordinary rows (see planAccounts).
  adjustments: {
    amount: number;
    change: {
      seq: number;
      kind: "AVSTEG" | "FORFLYTTNING";
      reason: string;
      revokedAt: Date | null;
    };
  }[];
};

type AccountRow = {
  id: string;
  budgetCostCenterId: string;
  accountCode: string;
  accountName: string;
};

type LineRow = {
  id: string;
  accountId: string;
  description: string;
  expression: string;
  sortOrder: number;
  quantity: string | null;
  unitPrice: string | null;
  values: Prisma.InputJsonValue;
};

const sourceAccountInclude = {
  orderBy: { accountCode: "asc" },
  include: {
    lineItems: { orderBy: { sortOrder: "asc" } },
    adjustments: { include: { change: true } },
  },
} as const;

function repointRefs(text: string, idMap: Map<string, string>): string {
  return text.replace(/@L([A-Za-z0-9]+)/g, (whole, id: string) => {
    const next = idMap.get(id);
    return next ? `@L${next}` : whole;
  });
}

// Ids are minted here so the whole tree goes in as three statements: a line item's id is needed for `idMap`
// before its account is written.
function planAccounts(
  accounts: SourceAccount[],
  targetCostCenterId: string,
  idMap: Map<string, string>,
): { accountRows: AccountRow[]; lineRows: LineRow[] } {
  const accountRows: AccountRow[] = [];
  const lineRows: LineRow[] = [];

  for (const acct of accounts) {
    const accountId = randomUUID();
    accountRows.push({
      id: accountId,
      budgetCostCenterId: targetCostCenterId,
      accountCode: acct.accountCode,
      accountName: acct.accountName,
      // Carried over: a hand-reclassified income/cost account would otherwise revert to code-based inference.
    });

    for (const li of acct.lineItems) {
      const id = randomUUID();
      idMap.set(li.id, id);
      lineRows.push({
        id,
        accountId,
        description: li.description,
        expression: li.expression,
        sortOrder: li.sortOrder,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        values: li.values as Prisma.InputJsonValue,
      });
    }

    // Editorial adjustments are baked in as ordinary rows carrying their motivering. Revoked ones are not copied.
    let n = Math.max(-1, ...acct.lineItems.map((li) => li.sortOrder)) + 1;
    for (const adj of acct.adjustments) {
      if (!isActive(adj.change)) continue;
      lineRows.push({
        id: randomUUID(),
        accountId,
        description: `${changeLabel(adj.change.kind, adj.change.seq)}: ${adj.change.reason}`,
        expression: String(adj.amount),
        sortOrder: n++,
        quantity: null,
        unitPrice: null,
        // Spelled out: createMany needs every row to name the same columns, or quiet ones get others' values.
        values: {},
      });
    }
  }

  return { accountRows, lineRows };
}

async function insertPlan(
  tx: Prisma.TransactionClient,
  { accountRows, lineRows }: { accountRows: AccountRow[]; lineRows: LineRow[] },
): Promise<void> {
  if (accountRows.length > 0) await tx.budgetAccount.createMany({ data: accountRows });
  if (lineRows.length > 0) await tx.budgetLineItem.createMany({ data: lineRows });
}

// Second pass, after everything exists, so references across cost centres in the same copy resolve.
async function repointCopies(
  tx: Prisma.TransactionClient,
  accounts: SourceAccount[],
  idMap: Map<string, string>,
): Promise<void> {
  for (const acct of accounts) {
    for (const li of acct.lineItems) {
      const values = (li.values ?? {}) as Record<string, string>;
      const next = {
        expression: repointRefs(li.expression, idMap),
        quantity: li.quantity === null ? null : repointRefs(li.quantity, idMap),
        unitPrice: li.unitPrice === null ? null : repointRefs(li.unitPrice, idMap),
        values: Object.fromEntries(
          Object.entries(values).map(([k, v]) => [
            k,
            typeof v === "string" ? repointRefs(v, idMap) : v,
          ]),
        ),
      };
      const changed =
        next.expression !== li.expression ||
        next.quantity !== li.quantity ||
        next.unitPrice !== li.unitPrice ||
        JSON.stringify(next.values) !== JSON.stringify(values);
      if (!changed) continue;
      await tx.budgetLineItem.update({
        where: { id: idMap.get(li.id)! },
        data: { ...next, values: next.values },
      });
    }
  }
}

// Variables and the cost-centre, account, line-item tree. Comments are not copied.
export async function copyBudgetContents(
  tx: Prisma.TransactionClient,
  srcBudgetId: string,
  targetBudgetId: string,
): Promise<void> {
  const src = await tx.budget.findUnique({
    where: { id: srcBudgetId },
    include: {
      variables: { orderBy: { sortOrder: "asc" } },
      costCenters: {
        orderBy: { sortOrder: "asc" },
        include: { accounts: sourceAccountInclude },
      },
    },
  });
  if (!src) return;

  const idMap = new Map<string, string>();

  // Ids are minted up front (see planAccounts) so accounts can be built before their cost centre is inserted.
  const costCentreRows = src.costCenters.map((cc) => ({
    id: randomUUID(),
    budgetId: targetBudgetId,
    costCenterId: cc.costCenterId,
    label: cc.label,
    sortOrder: cc.sortOrder,
  }));
  const plan = { accountRows: [] as AccountRow[], lineRows: [] as LineRow[] };
  src.costCenters.forEach((cc, i) => {
    const part = planAccounts(cc.accounts, costCentreRows[i].id, idMap);
    plan.accountRows.push(...part.accountRows);
    plan.lineRows.push(...part.lineRows);
  });

  if (costCentreRows.length > 0) {
    await tx.budgetCostCenter.createMany({ data: costCentreRows });
  }
  await insertPlan(tx, plan);

  for (const cc of src.costCenters) await repointCopies(tx, cc.accounts, idMap);

  // Variables last and repointed too: an expression can hold a cell reference (`=SEX01!C4`).
  if (src.variables.length) {
    await tx.budgetVariable.createMany({
      data: src.variables.map((v) => ({
        budgetId: targetBudgetId,
        name: v.name,
        expression: repointRefs(v.expression, idMap),
        sortOrder: v.sortOrder,
      })),
    });
  }
}

/** Duplicate one cost centre within its budget, detached. Returns the new BudgetCostCenter id. */
export async function cloneCostCenter(
  tx: Prisma.TransactionClient,
  sourceId: string,
): Promise<string | null> {
  const src = await tx.budgetCostCenter.findUnique({
    where: { id: sourceId },
    include: {
      costCenter: { select: { name: true } },
      accounts: sourceAccountInclude,
    },
  });
  if (!src) return null;

  // Takes the same lock as "add a sheet" (lib/server/sort-order.ts): the clone goes last in the list.
  await lockForAppend(tx, "budget", src.budgetId);
  const last = await tx.budgetCostCenter.findFirst({
    where: { budgetId: src.budgetId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const clone = await tx.budgetCostCenter.create({
    data: {
      budgetId: src.budgetId,
      costCenterId: null,
      label: `Kopia av ${sheetName(src)}`,
      sortOrder: nextSortOrder(last),
    },
  });

  const idMap = new Map<string, string>();
  await insertPlan(tx, planAccounts(src.accounts, clone.id, idMap));
  await repointCopies(tx, src.accounts, idMap);

  return clone.id;
}
