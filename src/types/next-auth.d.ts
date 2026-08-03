import type { DefaultSession } from "next-auth";

// Add our app field — the DB user id — to the session and JWT.
//
// Deliberately *not* the roles. A JWT is stamped at sign-in and never
// refreshed, so a role carried in it is a claim about the past; both halves of
// the app read the live ones instead (lib/server/current-user.ts, and
// lib/api/guard.ts through it). Leaving the field off the type is what stops a
// future call site reaching for a stale answer that looks authoritative.
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
  }
}
