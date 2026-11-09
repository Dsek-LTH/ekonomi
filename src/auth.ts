// Auth.js config: JWT sessions, sign-in through the guild's Authentik. Roles come from
// the User row (derived from Authentik groups at sign-in), never from the token.
import NextAuth, { type NextAuthConfig } from "next-auth";
import Authentik, { type AuthentikProfile } from "next-auth/providers/authentik";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { prisma } from "@/lib/server/db";
import { serverEnv } from "@/lib/server/env";
import { grantsFromGroups, sectionGroups } from "@/lib/server/authentik-roles";

/**
 * Claims on the session token. A local type because augmenting `next-auth/jwt` merges
 * into nothing (it re-exports from `@auth/core/jwt`).
 */
type AppToken = {
  /** Our User.id, the only identity claim the app acts on. */
  uid?: string;
  studentId?: string;
  name?: string | null;
  email?: string | null;
};

// `offline_access` and `splitname` are the guild's scopes (shared client registration);
// `splitname` makes Authentik send given_name/family_name separately.
const SCOPE = "openid profile email offline_access splitname";

/** Issuer with exactly one trailing slash: oauth4webapi compares it as a string against Authentik's discovery document. */
const ISSUER = `${serverEnv("AUTH_AUTHENTIK_ISSUER").replace(/\/+$/, "")}/`;

const providers: NextAuthConfig["providers"] = [
  Authentik({
    clientId: serverEnv("AUTH_AUTHENTIK_CLIENT_ID"),
    clientSecret: serverEnv("AUTH_AUTHENTIK_CLIENT_SECRET"),
    issuer: ISSUER,
    authorization: { params: { scope: SCOPE } },
    // `name` is joined from the split parts because User has one name column.
    profile: (profile: AuthentikProfile) => ({
      id: profile.sub,
      studentId: profile.preferred_username,
      email: profile.email,
      name:
        [profile.given_name, profile.family_name].filter(Boolean).join(" ") ||
        profile.name ||
        profile.preferred_username,
      groups: profile.groups ?? [],
    }),
  }),
];

// Dev-only: sign in as an existing seeded user.
if (process.env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { studentId: {} },
      // The user must already exist (roles stay as seeded); refusing is better than a silent bounce to /login.
      authorize: async (creds) => {
        const studentId = String(creds?.studentId ?? "").toLowerCase();
        if (!studentId) return null;
        const user = await prisma.user.findUnique({
          where: { studentId },
          select: { id: true, studentId: true, email: true, name: true },
        });
        return user
          ? {
              id: user.id,
              studentId: user.studentId,
              email: user.email,
              name: user.name,
              groups: [],
            }
          : null;
      },
    }),
  );
}

// Dev only: Next reports request.url with the bound origin (localhost), so a LAN phone's
// callback would point at itself. Production must not trust a client-supplied host (open redirect).
async function requestOrigin(baseUrl: string): Promise<string> {
  if (process.env.NODE_ENV === "production") return baseUrl;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    return host ? `${proto}://${host}` : baseUrl;
  } catch {
    return baseUrl; // called outside a request scope
  }
}

/** Upserts the User row for an Authentik identity. Roles and result units are overwritten from the group list on every sign-in. */
async function syncAuthentikUser(identity: {
  studentId: string;
  email: string;
  name: string;
  groups: readonly string[];
}) {
  const studentId = identity.studentId.toLowerCase();
  const email = identity.email.toLowerCase();
  const rest = {
    name: identity.name,
    authentikGroups: sectionGroups(identity.groups),
    ...(await grantsFromGroups(identity.groups)),
  };

  try {
    return await prisma.user.upsert({
      where: { studentId },
      create: { studentId, email, ...rest },
      update: { email, ...rest },
    });
  } catch (err) {
    // Email unique-index clash (P2002): keep the stored address and let the rest through.
    // Only P2002 is caught so a connection error is not misreported.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    return prisma.user.update({ where: { studentId }, data: rest });
  }
}

/** Absolute session length. Also the longest a post revoked in Authentik keeps working, since grants are derived at sign-in only. */
const SESSION_MAX_AGE = 24 * 60 * 60;

export const { handlers, auth } = NextAuth({
  providers,
  /**
   * Immutable JWT, written at sign-in only. `auth()` runs in Server Components, where
   * next-auth drops Set-Cookie, so a token that changes over time cannot be saved.
   */
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  trustHost: true,
  pages: { signIn: "/login" },
  callbacks: {
    async redirect({ url, baseUrl }) {
      const base = await requestOrigin(baseUrl);
      if (url.startsWith("/")) return `${base}${url}`;
      const origin = new URL(url).origin;
      return origin === base || origin === baseUrl ? url : base;
    },
    // A missing student id cannot be keyed to a User row.
    async signIn({ user }) {
      return Boolean(user?.studentId);
    },
    async jwt({ token, user, account }) {
      const t = token as typeof token & AppToken;

      if (user && account) {
        if (account.provider === "authentik" && user.studentId) {
          const dbUser = await syncAuthentikUser({
            studentId: user.studentId,
            email: user.email ?? "",
            name: user.name ?? user.studentId,
            groups: user.groups ?? [],
          });
          t.uid = dbUser.id;
          t.studentId = dbUser.studentId;
          t.name = dbUser.name;
          t.email = dbUser.email;
          return t;
        }

        if (user.id) {
          t.uid = user.id;
          t.studentId = user.studentId;
          t.name = user.name;
          t.email = user.email;
        }
      }

      return t;
    },
    async session({ session, token }) {
      const t = token as typeof token & AppToken;
      if (t.uid) {
        session.user.id = t.uid;
        session.user.studentId = t.studentId;
        if (t.name) session.user.name = t.name;
        if (t.email) session.user.email = t.email;
      }
      return session;
    },
  },
});
