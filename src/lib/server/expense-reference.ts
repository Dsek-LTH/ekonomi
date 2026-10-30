// Handing out the next utlägg or levfaktura reference. The format itself lives
// in lib/domain/reference.ts; this is the half that needs the database.
import type { Prisma } from "@/lib/generated/prisma/client";
import { nextReference, referencePrefix } from "@/lib/domain/reference";
import { today } from "@/lib/domain/date";

// A unique-constraint violation, which where this is used can only be two
// people taking the same reference at once. Duck-typed rather than imported:
// the code is Prisma's public contract for it, and this is the only thing here
// that cares which error it was.
const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

/**
 * Run `work` again if it lost a race for a reference.
 *
 * The number is read-then-written, and two people submitting in the same moment
 * both read the same "last" one. `Expense.reference` is unique, so the loser
 * hits a constraint violation rather than stealing the number: the right
 * outcome, but a 500 for someone who did nothing wrong. Take the number again
 * instead. A handful of attempts covers any burst the section can produce;
 * giving up is better than looping if something else is wrong.
 */
export async function withReferenceRetry<T>(work: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await work();
    } catch (e) {
      if (i >= attempts || !isUniqueViolation(e)) throw e;
    }
  }
}

/**
 * The next free reference in `year`. Must run inside the same transaction as
 * the write that takes it, and that transaction must be wrapped in
 * `withReferenceRetry`: reading the highest reference does not reserve it.
 *
 * The year is the Stockholm one, not the server's. The host runs on UTC, so
 * `new Date().getFullYear()` (what this used to read) still says the old year
 * for the first hour of a Swedish New Year's Day, and an utlägg sent in at
 * 00:30 on 1 January was numbered into the year that had just ended.
 */
export async function claimReference(
  tx: Prisma.TransactionClient,
  year: number = Number(today().slice(0, 4)),
): Promise<string> {
  // Highest first, which for a zero-padded fixed-width counter is the same as
  // largest, that is what the padding in lib/domain/reference.ts is for.
  const last = await tx.expense.findFirst({
    where: { reference: { startsWith: referencePrefix(year) } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  return nextReference(year, last?.reference ?? null);
}

/**
 * The next free levfaktura reference in `year`, "LEV26-0012". The same rules
 * as `claimReference`: inside the transaction that takes it, and that inside
 * `withReferenceRetry`.
 */
export async function claimInvoiceReference(
  tx: Prisma.TransactionClient,
  year: number = Number(today().slice(0, 4)),
): Promise<string> {
  const last = await tx.supplierInvoice.findFirst({
    where: { reference: { startsWith: referencePrefix(year, "LEV") } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  return nextReference(year, last?.reference ?? null, "LEV");
}
