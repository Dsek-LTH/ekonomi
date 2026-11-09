// Handing out the next utlägg or levfaktura reference. The format itself lives
// in lib/domain/reference.ts; this is the half that needs the database.
import type { Prisma } from "@/lib/generated/prisma/client";
import { nextReference, referencePrefix } from "@/lib/domain/reference";
import { today } from "@/lib/domain/date";

// A unique-constraint violation, which here can only be two people taking the same reference. Duck-typed.
const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

/**
 * Run `work` again if it lost a race for a reference (read-then-written; `Expense.reference` is unique).
 * A handful of attempts covers any burst.
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
 * The next free reference in `year`. Must run inside the transaction that takes it, wrapped in
 * `withReferenceRetry`. The year is the Stockholm one: the host runs on UTC.
 */
export async function claimReference(
  tx: Prisma.TransactionClient,
  year: number = Number(today().slice(0, 4)),
): Promise<string> {
  // Highest first, which for a zero-padded counter is the largest.
  const last = await tx.expense.findFirst({
    where: { reference: { startsWith: referencePrefix(year) } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  return nextReference(year, last?.reference ?? null);
}

/** The next free levfaktura reference in `year`, "LEV26-0012". Same rules as `claimReference`. */
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
