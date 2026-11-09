// Transactions whose outcome is what gets checked. A read-modify-write that validates an invariant is only
// sound under SERIALIZABLE: at READ COMMITTED two concurrent writers (e.g. two ticks in the SETTINGS row of
// Inställningar → Roller) both pass their check and commit a state neither evaluated. The timeout is raised
// for callers that re-derive grants for everyone (`reapplyGrants`).
import "server-only";

import { prisma } from "@/lib/server/db";

/** The client handed to a transaction callback: the full one minus the methods that cannot be nested. */
export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Postgres's serialization_failure and deadlock_detected. Prisma maps both onto P2034; the pg adapter can surface the raw SQLSTATE. */
const isRetryable = (err: unknown): boolean => {
  const e = err as { code?: unknown; meta?: { code?: unknown } };
  const codes = [e?.code, e?.meta?.code];
  return codes.some((c) => c === "P2034" || c === "40001" || c === "40P01");
};

/**
 * Run `fn` serializably, retrying conflicts. Retrying is safe because every caller writes finished state
 * rather than a delta.
 */
export async function serializable<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: "Serializable",
        timeout: 30_000,
        maxWait: 10_000,
      });
    } catch (err) {
      if (attempt >= 4 || !isRetryable(err)) throw err;
    }
  }
}

/** A transaction that writes a lot, with room to finish (Prisma's 5s default is too short). Ordinary isolation. */
export function bulkTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
}
