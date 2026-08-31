// Transactions whose *outcome* is what gets checked.
//
// A read-modify-write that validates an invariant inside the transaction is
// only sound under SERIALIZABLE. At READ COMMITTED, Postgres's default and
// what `prisma.$transaction()` uses when nothing tells it otherwise, two
// concurrent writers each see a world in which the other's change has not
// happened, both pass their check, and both commit into a state neither of them
// ever evaluated.
//
// That is not a corner case for the authority routes. `someoneCanReachSettings`
// guards the one state this app cannot recover from on its own, and the grid
// that edits it (Inställningar → Roller) sends one request per tickbox: two
// clicks in the SETTINGS row are two overlapping transactions, each of which
// looks up and finds the *other* role still holding it. Both commit, and the
// door is locked from the inside.
//
// The timeout is raised for the same callers, which re-derive grants for
// everyone a mapping change touches (`reapplyGrants`), work that does not fit
// in Prisma's 5s default once the section is a real size.
import "server-only";

import { prisma } from "@/lib/server/db";

/**
 * The client handed to a transaction callback: the full one minus the methods
 * that cannot be nested. Derived from `$transaction` itself rather than named
 * from the generated client, so this module stays as free of it as the rest of
 * lib/server is (see the duck-typed `tx` parameters in authentik-roles.ts and
 * capabilities.ts).
 */
export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Postgres's serialization_failure and deadlock_detected, however they reach
 * us. Prisma maps both onto P2034; the pg adapter can also surface the raw
 * SQLSTATE, so both spellings are matched rather than guessed between.
 */
const isRetryable = (err: unknown): boolean => {
  const e = err as { code?: unknown; meta?: { code?: unknown } };
  const codes = [e?.code, e?.meta?.code];
  return codes.some((c) => c === "P2034" || c === "40001" || c === "40P01");
};

/**
 * Run `fn` serializably, retrying the conflicts that isolation level exists to
 * produce.
 *
 * Retrying is safe here because every caller writes *finished state* rather than
 * a delta: a whole role's capabilities, a whole group's grant, one rename, so
 * replaying one is the same as running it once. A caller that accumulated
 * instead would need its own answer, and should not use this.
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

/**
 * A transaction that writes a lot, with room to finish.
 *
 * Prisma's interactive transactions time out after five seconds, which is the
 * right default for a write that touches a row or two and quite wrong for one
 * that copies a budget or re-derives a section. Those did not fail on anybody's
 * machine and then failed on real data, rolled back, and reported only that the
 * save had not worked.
 *
 * Ordinary isolation: unlike `serializable` above, these callers are not
 * checking an invariant against their own outcome. They are moving a lot of
 * rows, and paying for serialization would buy nothing.
 */
export function bulkTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
}
