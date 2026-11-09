// Appending to an ordered list without two appends landing on the same `sortOrder`. `MAX + 1` is a
// read-modify-write, so the parent row is locked first: appends to the same list queue, different lists never meet.
import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";

type Tx = Prisma.TransactionClient;

// The parent tables an ordered list hangs off. A whitelist: a table name is an identifier, not a bound parameter.
const PARENT_TABLE = {
  budget: '"Budget"',
  budgetCostCenter: '"BudgetCostCenter"',
  budgetAccount: '"BudgetAccount"',
} as const;

type OrderedListParent = keyof typeof PARENT_TABLE;

/** Take the parent row's lock for the rest of the surrounding transaction. Otherwise use `appendInOrder`. */
export async function lockForAppend(tx: Tx, parent: OrderedListParent, id: string): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM ${Prisma.raw(PARENT_TABLE[parent])} WHERE id = ${id} FOR UPDATE`;
}

/** Run `body` in a transaction with `parent` locked, so `MAX(sortOrder) + 1` is still right when the insert lands. */
export function appendInOrder<T>(
  parent: { model: OrderedListParent; id: string },
  body: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockForAppend(tx, parent.model, parent.id);
    return body(tx);
  });
}

/** The next place in a list, given its current last member. */
export const nextSortOrder = (last: { sortOrder: number } | null): number =>
  (last?.sortOrder ?? -1) + 1;
