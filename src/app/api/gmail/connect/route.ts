// GET /api/gmail/connect: start the one-time Google login as the inkorg mailbox. The nonce rides in an
// httpOnly cookie and goes to Google as `state`.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { authorizeUrl, gmailConfig } from "@/lib/server/gmail";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { STATE_COOKIE, redirectUri } from "../oauth";

export async function GET() {
  const g = await gate(canAccessSettings);
  if (!g.ok) return g.res;
  const c = gmailConfig();
  if (!c) return fail(503, "gmail.unconfigured");

  const nonce = randomBytes(16).toString("hex");
  (await cookies()).set(STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(c, nonce, redirectUri()));
}
