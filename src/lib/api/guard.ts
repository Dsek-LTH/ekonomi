// The gate every API route goes through. Roles are read from the database, not the JWT (stamped at sign-in, never refreshed).
//
//     const g = await gate(canAccessSettings);
//     if (!g.ok) return g.res;
import { NextResponse } from "next/server";
import { loadUser, resolveUserId } from "@/lib/server/current-user";
import type { Capability, Role } from "@/lib/domain/types";

// Success responses: 201 + created row for a POST; 200 + a body only when the outcome is information (DELETE
// cost-centers answers `{ retired }`); otherwise 204. Never `{ ok: true }`. Failures always use `fail()`.

/**
 * Run a write that addresses a row by id, answering 404 instead of a 500 when Prisma raises P2025 (the row was deleted
 * between check and write, or the link is stale).
 */
export async function orNotFound<T>(
  write: () => Promise<T>,
  error = "notFound",
): Promise<T | NextResponse> {
  try {
    return await write();
  } catch (err) {
    // Duck-typed so this module does not import the generated client.
    if ((err as { code?: unknown })?.code === "P2025") return fail(404, error);
    throw err;
  }
}

/**
 * Who is acting. `capabilities` is what every gate reads; `roles` is for the relational attest rules
 * (vice-skattmästare and resultatansvarig clauses in lib/domain/permissions.ts).
 */
// `name` is for words written on the actor's behalf (notifications), never for a decision.
export type Actor = { id: string; name: string; roles: Role[]; capabilities: Capability[] };

export type Gate = { ok: true; actor: Actor } | { ok: false; res: NextResponse };

/** A value substituted into an error message. `{ key }` is a message key the client translates first. */
export type ErrorValue = string | number | { key: string };

/**
 * An error response in the shape the client expects: `{ error }` is read by components/shell/use-mutation.ts. `error` is
 * a code under the `errors` namespace in messages/, resolved on the client (the server has no locale); unknown codes
 * show as-is (Fortnox pass-through). `values` fills ICU placeholders; `extra` carries flags like `needsFortnoxLogin`.
 */
export const fail = (
  status: number,
  error: string,
  opts?: { values?: Record<string, ErrorValue>; extra?: Record<string, unknown> },
): NextResponse =>
  NextResponse.json(
    { error, ...(opts?.values && { errorValues: opts.values }), ...opts?.extra },
    { status },
  );

/**
 * Resolve the acting user and, when `can` is given, check their authority. No argument means "any signed-in member",
 * a real policy: say it explicitly rather than leaving a handler ungated.
 */
export async function gate(
  can?: (caps: readonly Capability[]) => boolean,
  denied = "auth.denied",
): Promise<Gate> {
  const id = await resolveUserId();
  if (!id) return { ok: false, res: fail(401, "auth.signedOut") };

  // The session outlived the account: not a permission problem.
  // `loadUser` is shared with the page gates (lib/server/current-user.ts) and deduped per request.
  const row = await loadUser(id);
  if (!row) return { ok: false, res: fail(401, "auth.signedOut") };

  const actor: Actor = { id, name: row.name, roles: row.roles, capabilities: row.capabilities };
  if (can && !can(actor.capabilities)) return { ok: false, res: fail(403, denied) };
  return { ok: true, actor };
}
