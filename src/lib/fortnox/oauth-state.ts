// State carried across a Fortnox OAuth round trip, and who may start one. Shared by
// /api/fortnox/connect and /callback (not a route export, so neither route is imported as a library).
import { canAccessSettings, canLogInToFortnox } from "@/lib/domain/permissions";
import type { FortnoxAuthMode } from "@/lib/fortnox";

export const STATE_COOKIE = "fortnox_oauth_state";

/** Mode, anti-CSRF nonce and return path ride in one httpOnly cookie; only the nonce goes to Fortnox as `state`. */
interface OAuthState {
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
    const returnTo =
      typeof parsed.returnTo === "string" &&
      parsed.returnTo.startsWith("/") &&
      !parsed.returnTo.startsWith("//")
        ? parsed.returnTo
        : "/expenses?scope=all";
    return { nonce: parsed.nonce, mode, returnTo };
  } catch {
    return null;
  }
}

// Who may start which flow. The service connection is org-wide, so it is a settings matter;
// a personal login affects only its owner. The callback re-checks the same rule.
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
