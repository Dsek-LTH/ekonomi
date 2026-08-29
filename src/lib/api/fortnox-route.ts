// The shell the Fortnox sync endpoints share: authority, then a live service
// connection, then a token — and one place that turns a thrown FortnoxError
// into a response instead of a 500.
//
// Kept apart from lib/fortnox/ on purpose: that module talks to Fortnox and
// knows nothing about requests, which is what makes it usable from the CLI
// (prisma/sync-fortnox.ts) and the scheduled job as well as from a route.
import { NextResponse } from "next/server";
import { FortnoxError, getConnection, getServiceToken } from "@/lib/fortnox";
import { fail, gate, type Actor } from "@/lib/api/guard";
import type { Capability } from "@/lib/domain/types";

/**
 * "Not connected" is a 409 rather than a 403: the caller has the right, the
 * organisation simply has no connection yet for them to use it through.
 */
export async function denyNoFortnox(): Promise<NextResponse | null> {
  return (await getConnection()) ? null : fail(409, "fortnox.notConnected");
}

export type ServiceGate =
  | { ok: true; actor: Actor; token: string }
  | { ok: false; res: NextResponse };

/**
 * Gate a route that acts on Fortnox as the organisation, and hand it a service
 * token to act with:
 *
 *     const g = await gateFortnoxService(canAccessSettings, "Endast … kan synka");
 *     if (!g.ok) return g.res;
 *     try { … g.token … } catch (e) { return fortnoxFailure(e); }
 *
 * Routes whose work fetches its own token (syncLedger does) want `gate` plus
 * `denyNoFortnox` instead — there is no token for them to be handed.
 */
export async function gateFortnoxService(
  can: (caps: readonly Capability[]) => boolean,
  denied: string,
): Promise<ServiceGate> {
  const g = await gate(can, denied);
  if (!g.ok) return g;

  const offline = await denyNoFortnox();
  if (offline) return { ok: false, res: offline };

  try {
    return { ok: true, actor: g.actor, token: await getServiceToken() };
  } catch (e) {
    return { ok: false, res: fortnoxFailure(e) };
  }
}

/**
 * A failed Fortnox call as a response. 403 gets its own message: it means the
 * connection lacks a scope, which is fixed by reconnecting rather than retrying,
 * and nothing the API says makes that clear. `forbidden` names the missing
 * scope where the caller knows which one it needs.
 */
export function fortnoxFailure(
  e: unknown,
  opts: { forbidden?: string; fallback?: string } = {},
): NextResponse {
  const { forbidden, fallback = "fortnox.syncFailed" } = opts;
  if (e instanceof FortnoxError) {
    if (e.status === 403) {
      return fail(403, forbidden ?? "fortnox.missingScope");
    }
    return fail(e.status ?? 502, e.message);
  }
  return fail(502, e instanceof Error ? e.message : fallback);
}
