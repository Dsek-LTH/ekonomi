// The state carried across a Fortnox OAuth round trip, and who is allowed to
// start one.
//
// Both halves of the flow need this: /api/fortnox/connect writes the cookie and
// sends the browser off, /api/fortnox/callback reads it back and re-checks the
// same authority. It lives here rather than in either route because a route
// module is an HTTP entry point: its exports are the methods the framework
// calls, and importing one route from another makes an entry point into a
// library as well.
import { canAccessSettings, canLogInToFortnox } from "@/lib/domain/permissions";
import type { FortnoxAuthMode } from "@/lib/fortnox";

export const STATE_COOKIE = "fortnox_oauth_state";

/**
 * The mode, the anti-CSRF nonce and where to return afterwards all ride in one
 * httpOnly cookie; only the nonce goes to Fortnox as `state`.
 */
export interface OAuthState {
  nonce: string;
  mode: FortnoxAuthMode;
  returnTo: string;
}

export function encodeState(state: OAuthState): string {
  return JSON.stringify(state);
}

export function decodeState(raw: string | undefined): OAuthState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthState>;
    if (typeof parsed.nonce !== "string") return null;
    const mode = parsed.mode === "user" ? "user" : "service";
    // Only same-origin paths, never let the callback bounce to another site.
    const returnTo =
      typeof parsed.returnTo === "string" &&
      parsed.returnTo.startsWith("/") &&
      !parsed.returnTo.startsWith("//")
        ? parsed.returnTo
        : "/bookkeeping";
    return { nonce: parsed.nonce, mode, returnTo };
  } catch {
    return null;
  }
}

// Who may start which flow. The service connection is org-wide infrastructure
// and lives in the settings; a personal login only ever affects the person
// making it, so the whole treasury can do their own. Shared with the callback,
// which re-checks the same rule when the flow comes back.
export function authorityFor(mode: FortnoxAuthMode) {
  return mode === "service"
    ? {
        can: canAccessSettings,
        denied: "auth.treasurerConnectFortnox",
      }
    : {
        can: canLogInToFortnox,
        denied: "auth.treasuryLoginFortnox",
      };
}
