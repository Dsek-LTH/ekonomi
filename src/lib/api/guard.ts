// The gate every API route goes through. One shape, one place, so a handler
// starts with what it is allowed to do rather than six lines of preamble:
//
//     const g = await gate(canAccessSettings);
//     if (!g.ok) return g.res;
//     // ... g.actor.id, g.actor.roles
//
// Roles are read from the database, not from the session. The session is a JWT
// stamped at sign-in (see auth.ts) and never refreshed, so a role taken away
// this morning would still open doors until the person happened to sign out.
// Authority is worth one indexed lookup per request.
import { NextResponse } from "next/server";
import { loadUser, resolveUserId } from "@/lib/server/current-user";
import type { Role } from "@/lib/domain/types";

// ── What a handler answers with ────────────────────────────────────
//
// On failure, always `fail()` — see below.
//
// On success, one of three, chosen by whether the caller has anything to learn:
//
//   201 + the created row   a POST that made something
//   200 + a body            when the outcome itself is information the caller
//                           reads — DELETE /api/cost-centers/[id] answers
//                           `{ retired }`, because a cost centre in use is
//                           retired rather than deleted and the screen says so
//   204, no body            everything else: the write happened, there is
//                           nothing to report, and the client refreshes
//
// `{ ok: true }` as a whole response body is not one of them. It says only what
// the status code already said, and a handler that returns it is telling the
// next reader there might be something in there worth checking.

/** Who is acting, with the roles they hold right now. */
export type Actor = { id: string; roles: Role[] };

export type Gate = { ok: true; actor: Actor } | { ok: false; res: NextResponse };

/**
 * A value substituted into an error message. A plain string or number goes in
 * as-is; `{ key }` is a message key that the client translates first, so an
 * enum inside a sentence ends up in the reader's language too.
 */
export type ErrorValue = string | number | { key: string };

/**
 * An error response in the shape the client expects — `{ error }` is what
 * components/shell/use-mutation.ts reads to show a message.
 *
 * `error` carries a *code*, not prose: a key under the `errors` namespace in
 * messages/. The server has no locale (the reader's is a cookie on their
 * request, not a property of the handler), so the message is resolved on the
 * client. Anything that is not a known code falls through and is shown as-is,
 * which is what keeps pass-through text from Fortnox readable.
 *
 * `values` fills the code's ICU placeholders; `extra` carries the odd extra
 * flag some callers need (e.g. `needsFortnoxLogin`).
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
 * Resolve the acting user and, when `can` is given, check their authority.
 * Called with no argument it means "any signed-in member", which is a real
 * policy and not the absence of one — say it explicitly rather than leaving a
 * handler ungated.
 */
export async function gate(
  can?: (roles: readonly Role[]) => boolean,
  denied = "auth.denied",
): Promise<Gate> {
  const id = await resolveUserId();
  if (!id) return { ok: false, res: fail(401, "auth.signedOut") };

  // Signed in against a user row that no longer exists: the session outlived
  // the account, which is not a permission problem.
  // `loadUser` is shared with the page-side gates in lib/server/current-user.ts
  // and deduped per request, so gating twice costs one lookup.
  const row = await loadUser(id);
  if (!row) return { ok: false, res: fail(401, "auth.signedOut") };

  const actor: Actor = { id, roles: row.roles };
  if (can && !can(actor.roles)) return { ok: false, res: fail(403, denied) };
  return { ok: true, actor };
}
