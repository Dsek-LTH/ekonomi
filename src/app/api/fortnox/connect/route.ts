// Start a Fortnox OAuth2 flow: redirect the browser to Fortnox's consent
// screen. Two modes, picked with ?mode=:
//
//   service (default): the org's read/sync connection. Admins only, and the
//                       person must be a system administrator in Fortnox.
//   user:               the caller's own short-lived login for bookkeeping.
//
// The mode, the anti-CSRF nonce and where to return afterwards all ride in one
// httpOnly cookie; only the nonce goes to Fortnox as `state`.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { authorizeUrl, fortnoxConfigured, type FortnoxAuthMode } from "@/lib/fortnox";
import { STATE_COOKIE, authorityFor, encodeState } from "@/lib/fortnox/oauth-state";
import { fail, gate } from "@/lib/api/guard";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode: FortnoxAuthMode = url.searchParams.get("mode") === "user" ? "user" : "service";
  const returnTo = url.searchParams.get("returnTo") ?? "/bookkeeping";

  const { can, denied } = authorityFor(mode);
  const g = await gate(can, denied);
  if (!g.ok) return g.res;

  if (!fortnoxConfigured()) {
    return fail(503, "fortnox.unconfigured");
  }

  const nonce = randomBytes(16).toString("hex");
  (await cookies()).set(STATE_COOKIE, encodeState({ nonce, mode, returnTo }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 min, matches Fortnox's auth-code lifetime
  });

  return NextResponse.redirect(authorizeUrl(nonce, mode));
}
