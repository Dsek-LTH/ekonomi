import type { DefaultSession } from "next-auth";

// Our app fields on the session, the JWT, and the object a provider's `profile`
// callback returns.
//
// Deliberately *not* the roles. A JWT is stamped at sign-in and never written
// again (see `session` in auth.ts), so a role carried in it is a claim about
// the past; both halves of the app read the live ones instead
// (lib/server/current-user.ts, and lib/api/guard.ts through it). Leaving the
// field off the type is what stops a future call site reaching for a stale
// answer that looks authoritative.
declare module "next-auth" {
  interface Session {
    user: { id: string; studentId?: string } & DefaultSession["user"];
  }

  // What auth.ts's `profile` callback returns, and therefore what the `user`
  // argument of the jwt callback carries on a sign-in.
  interface User {
    studentId?: string;
    /** Authentik group list. Read once, to derive roles — never stored here. */
    groups?: string[];
  }
}

// The JWT's own extra claims are *not* declared here. `next-auth/jwt` only
// re-exports the interface from `@auth/core/jwt`, so an augmentation of it
// declares a second, unrelated JWT rather than merging with the real one — the
// fields silently stay `unknown`, which is how this was found. `@auth/core` is
// not a direct dependency and cannot be augmented either, so the token's shape
// is a local type in auth.ts (`AppToken`), which is the only file that reads it.
