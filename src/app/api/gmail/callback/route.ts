// GET /api/gmail/callback: where Google sends the person back after logging in as the inkorg mailbox.
// Checks the nonce and the caller's right again, refuses a login to any other mailbox than GMAIL_MAILBOX,
// then stores the login and starts the watch. Always lands back on the Inkorg with ?gmail=connected or
// ?gmail=error&reason=...
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, gmailConfig, profile, revoke } from "@/lib/server/gmail";
import { connectMailbox } from "@/lib/server/inbound-mail";
import { canAccessSettings } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";
import { RETURN_TO, STATE_COOKIE, redirectUri } from "../oauth";

function back(params: Record<string, string>): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `${RETURN_TO}?${new URLSearchParams(params)}` },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const jar = await cookies();
  const nonce = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (error) {
    console.warn(`[gmail] login refused: ${error}`);
    return back({ gmail: "error", reason: error === "access_denied" ? "denied" : "failed" });
  }
  if (!code || !state || !nonce || state !== nonce) {
    return back({ gmail: "error", reason: "invalidState" });
  }
  const g = await gate(canAccessSettings);
  if (!g.ok) return back({ gmail: "error", reason: "forbidden" });
  const c = gmailConfig();
  if (!c) return back({ gmail: "error", reason: "unconfigured" });

  let refreshToken: string;
  try {
    refreshToken = await exchangeCode(c, code, redirectUri());
    const { emailAddress } = await profile({ ...c, refreshToken });
    if (emailAddress.toLowerCase() !== c.mailbox) {
      await revoke(refreshToken);
      return back({ gmail: "error", reason: "wrongMailbox" });
    }
  } catch (err) {
    console.error("[gmail] connecting the mailbox failed", err);
    return back({ gmail: "error", reason: "failed" });
  }

  try {
    await connectMailbox(refreshToken, g.actor.id);
  } catch (err) {
    // The login is stored. Starting the watch failed, usually the topic's publish permission.
    console.error("[gmail] starting the watch failed", err);
    return back({ gmail: "error", reason: "watchFailed" });
  }
  return back({ gmail: "connected" });
}
