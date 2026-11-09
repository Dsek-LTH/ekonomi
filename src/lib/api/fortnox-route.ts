// Shell shared by the Fortnox sync endpoints: authority, a live service connection, a token, and one place that turns
// a FortnoxError into a response. Kept apart from lib/fortnox/, which the CLI and scheduled job also use.
import { NextResponse } from "next/server";
import { FortnoxError, getConnection, getServiceToken } from "@/lib/fortnox";
import { fail, gate, type Actor } from "@/lib/api/guard";
import type { Capability } from "@/lib/domain/types";

/** "Not connected" is a 409, not 403: the caller has the right, the organisation has no connection yet. */
export async function denyNoFortnox(): Promise<NextResponse | null> {
  return (await getConnection()) ? null : fail(409, "fortnox.notConnected");
}

type ServiceGate = { ok: true; actor: Actor; token: string } | { ok: false; res: NextResponse };

/**
 * Gate a route that acts on Fortnox as the organisation and hand it a service token. Routes that fetch their own
 * token (syncLedger) want `gate` plus `denyNoFortnox` instead.
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

/** A failed Fortnox call as a response. 403 gets its own message: the connection lacks a scope, fixed by reconnecting. `forbidden` names the scope. */
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
