// Start a Fortnox OAuth2 flow (?mode=service, default: admin-only read/sync connection, needs a Fortnox
// system administrator; ?mode=user: the caller's own short-lived bookkeeping login). Mode, nonce and
// return path ride in one httpOnly cookie; only the nonce goes to Fortnox as `state`.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { authorizeUrl, fortnoxConfigured, type FortnoxAuthMode } from "@/lib/fortnox";
import { STATE_COOKIE, authorityFor, encodeState } from "@/lib/fortnox/oauth-state";
import { fail, gate } from "@/lib/api/guard";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode: FortnoxAuthMode = url.searchParams.get("mode") === "user" ? "user" : "service";
  const returnTo = url.searchParams.get("returnTo") ?? "/expenses?scope=all";

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
