// Fortnox OAuth2 redirect target, shared by both flows. Verifies the state
// nonce, exchanges the authorization code, and then — depending on the mode
// stashed in the state cookie — either replaces the org's service connection or
// starts a personal bookkeeping session for the caller.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { gate } from "@/lib/api/guard";
import {
  exchangeCode,
  getCompanyInfo,
  getConnection,
  getMe,
  saveConnection,
  saveUserSession,
  FortnoxError,
} from "@/lib/fortnox";
import { STATE_COOKIE, authorityFor, decodeState } from "@/lib/fortnox/oauth-state";

function back(path: string, params: Record<string, string>): NextResponse {
  const url = new URL(path, "http://relative.invalid");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `${url.pathname}${url.search}${url.hash}` },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const jar = await cookies();
  const state = decodeState(jar.get(STATE_COOKIE)?.value);
  jar.delete(STATE_COOKIE);

  const returnTo = state?.returnTo ?? "/bookkeeping";

  if (error) {
    return back(returnTo, { fortnox: "error", reason: error });
  }
  if (!code || !stateParam || !state || stateParam !== state.nonce) {
    return back(returnTo, { fortnox: "error", reason: "invalid_state" });
  }

  // Re-check authority here too: the cookie proves the flow started with us,
  // not that the person finishing it still has the right to.
  const g = await gate(authorityFor(state.mode).can);
  if (!g.ok) return back(returnTo, { fortnox: "error", reason: "forbidden" });
  const user = g.actor;

  try {
    const token = await exchangeCode(code);

    if (state.mode === "service") {
      const company = await getCompanyInfo(token.access_token).catch(() => ({
        name: null,
        orgNumber: null,
      }));
      await saveConnection(token, {
        connectedById: user.id,
        companyName: company.name,
        orgNumber: company.orgNumber,
      });
      return back(returnTo, { fortnox: "connected" });
    }

    // Personal login. Refuse it unless it lands in the same Fortnox company as
    // the service connection — otherwise a bookkeeper with access to several
    // companies could quietly post the section's vouchers into the wrong books.
    const conn = await getConnection();
    if (!conn) {
      return back(returnTo, { fortnox: "error", reason: "no_service_connection" });
    }
    const company = await getCompanyInfo(token.access_token);
    if (conn.orgNumber && company.orgNumber && conn.orgNumber !== company.orgNumber) {
      return back(returnTo, { fortnox: "error", reason: "wrong_company" });
    }

    const me = await getMe(token.access_token);
    await saveUserSession(user.id, token, {
      fortnoxUserName: me.name,
      fortnoxUserEmail: me.email,
    });
    return back(returnTo, { fortnox: "logged_in" });
  } catch (e) {
    const reason = e instanceof FortnoxError ? e.message : "token_exchange_failed";
    return back(returnTo, { fortnox: "error", reason });
  }
}
