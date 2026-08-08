// Deep-copying budget contents: a whole budget (starting a new draft, or next
// year from this year's) and a single cost centre inside one. Both go through
// the same copy + repoint pair below, so they can't drift apart.
//
// A copy is a copy and nothing more: the new budget holds its own rows and no
// record of where they came from, and editing either one leaves the other
// alone. That is the whole point — see Budget in schema.prisma.
//
// The repointing is the part that isn't obvious. A cell reference is stored
// bound to the line item's id (`@L<id>:<field>`, see lib/budget/grid.ts), so a
// verbatim copy leaves every formula in the copy pointing at the row it was
// copied FROM. Across budgets those rows aren't even in the same budget, and
// nothing resolves them; within a cloned cost centre they resolve to the
// original's figures, so the two sheets would move together forever after. So
// each copy remembers old id → new id and rewrites the references it owns. A
// reference to a row that wasn't copied is left alone — that row is still
// exactly the row meant.
import type { Prisma } from "@/lib/generated/prisma/client";
import { lockForAppend, nextSortOrder } from "@/lib/server/sort-order";
import { sheetName } from "@/lib/budget";
import { changeLabel, isActive } from "@/lib/budget/changes";

// The shape both copy paths read: one cost centre's accounts and their rows.
type SourceAccount = {
  accountCode: string;
  accountName: string;
  sortOrder: number;
  kindOverride: "INCOME" | "COST" | null;
  lineItems: {
    id: string;
    description: string;
    expression: string;
    quantity: string | null;
    unitPrice: string | null;
    sortOrder: number;
    values: Prisma.JsonValue;
  }[];
  // Editorial adjustments in force on this account (see BudgetChange in
  // schema.prisma). They are copied as ordinary rows — see copyAccounts.
  adjustments: {
    amount: number;
    change: { seq: number; kind: "AVSTEG" | "FORFLYTTNING"; reason: string; revokedAt: Date | null };
  }[];
};

// What a copy needs to read off an account, for both copy paths.
const sourceAccountInclude = {
  orderBy: { sortOrder: "asc" },
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

// Copy one cost centre's accounts and rows onto `targetCostCenterId`, recording
// every old line id → new line id in `idMap` for the repointing pass.
async function copyAccounts(
  tx: Prisma.TransactionClient,
  accounts: SourceAccount[],
  targetCostCenterId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const acct of accounts) {
    const newAcct = await tx.budgetAccount.create({
      data: {
        budgetCostCenterId: targetCostCenterId,
        accountCode: acct.accountCode,
        accountName: acct.accountName,
        sortOrder: acct.sortOrder,
        // Carried over deliberately: an account reclassified income↔cost by hand
        // would silently revert to code-based inference in the copy without this.
        kindOverride: acct.kindOverride,
      },
    });
    for (const li of acct.lineItems) {
      const created = await tx.budgetLineItem.create({
        data: {
          accountId: newAcct.id,
          description: li.description,
          expression: li.expression,
          sortOrder: li.sortOrder,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          values: li.values as Prisma.InputJsonValue,
        },
      });
      idMap.set(li.id, created.id);
    }

    // Editorial adjustments are baked in as ordinary rows. The copy is a copy of
    // the figures, not of the decisions behind them: those belong to the budget
    // they were made on and stay there, so the row carries its motivering with
    // it rather than pointing at a history the copy doesn't have. Revoked ones
    // are simply not copied — they count for nothing.
    let n = Math.max(-1, ...acct.lineItems.map((li) => li.sortOrder)) + 1;
    for (const adj of acct.adjustments) {
      if (!isActive(adj.change)) continue;
      await tx.budgetLineItem.create({
        data: {
          accountId: newAcct.id,
          description: `${changeLabel(adj.change.kind, adj.change.seq)}: ${adj.change.reason}`,
          expression: String(adj.amount),
          sortOrder: n++,
        },
      });
    }
  }
}

// Second pass: every new row exists, so the copied formulas can be pointed at
// the copies. Runs once over all the sources, after everything is created, so a
// reference across to another cost centre in the same copy resolves too.
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
          Object.entries(values).map(([k, v]) => [k, typeof v === "string" ? repointRefs(v, idMap) : v]),
        ),
      };
      const changed = next.expression !== li.expression
        || next.quantity !== li.quantity
        || next.unitPrice !== li.unitPrice
        || JSON.stringify(next.values) !== JSON.stringify(values);
      if (!changed) continue; // most rows are plain numbers
      await tx.budgetLineItem.update({
        where: { id: idMap.get(li.id)! },
        data: { ...next, values: next.values as Prisma.InputJsonValue },
      });
    }
  }
}

// Everything that makes up a budget's numbers: variables, and the
// cost-centre → account → line-item tree. Comments are deliberately left
// behind — they're a discussion about one budget, not part of it.
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

  // One id map for the whole budget: every row in it is copied, so every
  // reference between them belongs to the copy.
  const idMap = new Map<string, string>();
  for (const cc of src.costCenters) {
    const newCc = await tx.budgetCostCenter.create({
      data: {
        budgetId: targetBudgetId,
        costCenterId: cc.costCenterId,
        label: cc.label,
        sortOrder: cc.sortOrder,
      },
    });
    await copyAccounts(tx, cc.accounts, newCc.id, idMap);
  }
  for (const cc of src.costCenters) await repointCopies(tx, cc.accounts, idMap);

  // Variables last, and repointed like everything else. A variable is evaluated
  // against the cell map too (see lib/budget/eval.ts), so its expression can
  // hold a cell reference — `=SEX01!C4` typed on the variables sheet is stored
  // as `@L<id>:expression` exactly as it would be in a row. Copied verbatim
  // those pointed back at the source budget's rows, which are not in the copy's
  // cell map at all, so the variable quietly evaluated to nothing.
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

/**
 * Duplicate one cost centre — accounts, line items and formulas — within its own
 * budget. The copy is created detached: the source already holds the only link
 * to that cost centre, and which one the copy is meant to be is the user's next
 * decision, not something to guess. Returns the new BudgetCostCenter id.
 */
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

  // The clone goes last in the budget, which is a read-modify-write on the same
  // list every "add a sheet" touches — so it takes the same lock they do, for
  // the same reason. See lib/server/sort-order.ts.
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
  await copyAccounts(tx, src.accounts, clone.id, idMap);
  await repointCopies(tx, src.accounts, idMap);

  return clone.id;
}
