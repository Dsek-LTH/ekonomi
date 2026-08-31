// Appending to an ordered list, without two appends landing on the same place.
//
// Every sorted list in the budget (variables, sheets, accounts, rows) numbers
// its members with a `sortOrder`, and adding one means "one past the last".
// Read as `MAX(sortOrder) + 1` and then written, that is a read-modify-write
// across two statements: two people adding a row to the same account at the
// same moment both read the same maximum and both write it. Nothing fails.
// Postgres is happy, both rows exist, but they now tie, and a tie in an ORDER
// BY is resolved however the planner feels like today. That is the same
// instability the list queries carry explicit tiebreakers for; here it can be
// prevented outright rather than sorted out afterwards.
//
// So the parent row is locked first. Two appends to the *same* list queue up
// behind each other and come out numbered 5 and 6; appends to different lists
// never meet, because the lock is per parent row rather than per table. Nobody
// gets an error and nobody has to retry, which is why this is a lock rather
// than a serialisable transaction.
import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";

type Tx = Prisma.TransactionClient;

// The parent tables an ordered list hangs off. A whitelist, because a table
// name is an identifier and cannot be a bound parameter. Only these constants
// ever reach the SQL, and the id beside them is bound normally.
const PARENT_TABLE = {
  budget: '"Budget"',
  budgetCostCenter: '"BudgetCostCenter"',
  budgetAccount: '"BudgetAccount"',
} as const;

export type OrderedListParent = keyof typeof PARENT_TABLE;

/**
 * Take the parent row's lock for the rest of the surrounding transaction.
 *
 * For code that already has a transaction of its own. Everything else wants
 * `appendInOrder`, which opens one.
 */
export async function lockForAppend(
  tx: Tx,
  parent: OrderedListParent,
  id: string,
): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM ${Prisma.raw(PARENT_TABLE[parent])} WHERE id = ${id} FOR UPDATE`;
}

/**
 * Run `body` in a transaction with `parent` locked, so the
 * `MAX(sortOrder) + 1` inside it is still the answer when the insert lands.
 *
 * The body does the reading and the writing itself. It is two ordinary Prisma
 * calls on `tx` and reads better left where it is than folded into an argument.
 */
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
