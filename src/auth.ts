// Auth.js (NextAuth v5) configuration. JWT sessions; sign-in goes through the
// guild's Authentik (auth.dsek.se), which is also where Google sits — federated
// upstream, so this app never sees a Google client. Same arrangement as the
// guild's own web app (Dsek-LTH/web, src/hooks.server.ts): one identity
// provider, one place a mandate is granted or revoked.
//
// The Authentik identity is mapped onto our own User row, keyed on the student
// id (`preferred_username`). Roles are derived from the Authentik group list
// (lib/server/authentik-roles.ts) and written to that row — the row, not the
// token, is what every authority question is answered from.
//
// A dev-only credentials provider signs in as a seeded user without reaching
// Authentik at all.
import NextAuth, { type NextAuthConfig } from "next-auth";
import Authentik, { type AuthentikProfile } from "next-auth/providers/authentik";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { prisma } from "@/lib/server/db";
import { serverEnv } from "@/lib/server/env";
import { rolesFromGroups, sameRoles } from "@/lib/server/authentik-roles";
import type { Role } from "@/lib/domain/types";

/**
 * The claims this app puts on the session token, on top of the standard ones.
 *
 * A local type rather than a module augmentation: `next-auth/jwt` re-exports
 * its JWT interface from `@auth/core/jwt`, which is not a package we depend on
 * directly, and an augmentation of the re-export merges into nothing — the
 * fields quietly stay `unknown`. This is the only file that reads them.
 *
 * Note what is not here: the roles. The token says who signed in; the database
 * says what they may do (lib/server/current-user.ts).
 */
type AppToken = {
  /** Our User.id — the only identity claim the app acts on. */
  uid?: string;
  studentId?: string;
  name?: string | null;
  email?: string | null;
  /** Which provider signed this in; only "authentik" tokens are refreshable. */
  provider?: string;
  refresh_token?: string;
  /** Unix seconds. Absent for a dev sign-in, which has nothing to refresh. */
  expires_at?: number;
  error?: string;
};

// `offline_access` is what gets us a refresh token, and `splitname` is what
// makes Authentik send given_name/family_name separately. Both are the guild's
// scopes, verbatim — an app asking for less would get a profile shaped
// differently from the one their code documents.
const SCOPE = "openid profile email offline_access splitname";

/**
 * The issuer, with exactly one trailing slash.
 *
 * That is the form Authentik puts in its own discovery document (`"issuer":
 * "https://auth.dsek.se/application/o/dev/"`), and oauth4webapi compares the
 * two as strings — an issuer stripped of its slash fails discovery with
 * "response body issuer property does not match the expected value", before the
 * browser is ever redirected. Normalised rather than taken verbatim, so a value
 * copied without the slash works too; the well-known path is appended
 * slash-safely either way.
 */
const ISSUER = `${serverEnv("AUTH_AUTHENTIK_ISSUER").replace(/\/+$/, "")}/`;

const providers: NextAuthConfig["providers"] = [
  Authentik({
    clientId: serverEnv("AUTH_AUTHENTIK_CLIENT_ID"),
    clientSecret: serverEnv("AUTH_AUTHENTIK_CLIENT_SECRET"),
    issuer: ISSUER,
    authorization: { params: { scope: SCOPE } },
    // Everything downstream reads these names, so the mapping happens once,
    // here. `name` is joined from the split parts because our User has one
    // name column — the split is Authentik's shape, not ours.
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

// Dev-only: sign in as an existing seeded user without Authentik.
if (process.env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { studentId: {} },
      // The user has to already exist, and their roles are left exactly as
      // seeded. Auto-provisioning is Authentik's path (see the jwt callback):
      // here it would mean a typo'd student id signed you in as nobody, and
      // every page would bounce you back to /login without saying why.
      // Refusing the sign-in outright is the same answer, said where it can be
      // seen.
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

// Next's dev server reports `request.url` with the origin it bound to
// (localhost:3000), whatever Host the client actually sent. Auth.js takes its
// baseUrl from that URL, so a sign-in from a phone on the LAN gets its callback
// rewritten to localhost — which on the phone is the phone. Trust the real
// request host instead. Dev-only: in production the deployment's own origin is
// what baseUrl already resolves to, and honouring a client-supplied host there
// would be an open-redirect vector.
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

/**
 * The User row behind an Authentik identity, created on first sign-in and kept
 * in step on every one after.
 *
 * Roles are overwritten from the group list, deliberately: Authentik is the
 * register of who holds which post, so a mandate that ended there has ended
 * here by the holder's next sign-in without anybody remembering to do it. The
 * consequence is that roles are not editable in this app at all — the place to
 * change one is Authentik.
 */
async function syncAuthentikUser(identity: {
  studentId: string;
  email: string;
  name: string;
  groups: readonly string[];
}) {
  const studentId = identity.studentId.toLowerCase();
  const email = identity.email.toLowerCase();
  const rest = { name: identity.name, roles: rolesFromGroups(identity.groups) };

  try {
    return await prisma.user.upsert({
      where: { studentId },
      create: { studentId, email, ...rest },
      update: { email, ...rest },
    });
  } catch (err) {
    // The one thing worth recovering from here is the unique index on email —
    // someone else's row still holds the address this person now uses (a
    // handover of a functionary address, most often). That is a data problem
    // for an admin to sort out, and no reason to refuse the sign-in: keep the
    // stored address and let the rest through. Only the update is retried; a
    // *create* that failed on the email would fail again, and it failing is
    // correct.
    //
    // Narrowed to that one code (P2002) on purpose: catching everything meant
    // an unreachable database was reported as a failure of the retry, pointing
    // at the wrong line and hiding the connection error underneath it.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    return prisma.user.update({ where: { studentId }, data: rest });
  }
}

/** Re-derive roles after a token refresh, writing only when they changed. */
async function refreshRoles(userId: string, groups: readonly string[]) {
  const roles = rolesFromGroups(groups);
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: true },
  });
  if (!current || sameRoles(current.roles as Role[], roles)) return;
  await prisma.user.update({ where: { id: userId }, data: { roles } });
}

/** The `groups` claim of an Authentik access token, or undefined if unreadable. */
function groupsInAccessToken(accessToken: unknown): string[] | undefined {
  if (typeof accessToken !== "string") return undefined;
  const payload = accessToken.split(".")[1];
  if (!payload) return undefined; // opaque token — not every provider signs JWTs
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return Array.isArray(claims.groups) ? (claims.groups as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Authentik's token endpoint, taken from its discovery document.
 *
 * Asked for rather than derived: the endpoint is not under the application's
 * issuer (Authentik serves one `/application/o/token/` per instance while each
 * application has its own `/application/o/<slug>/`), so assembling the URL by
 * hand means encoding a guess about a layout no spec promises — and a guess
 * needs an override for when it is wrong. The provider publishes the answer,
 * and Auth.js fetches this same document on every sign-in anyway.
 *
 * The promise is memoised, not the string: the document is static, and holding
 * the in-flight promise means concurrent refreshes make one request between
 * them. A failed lookup is not cached — that would turn one bad moment into a
 * process that can never refresh a token again.
 */
let discovery: Promise<string> | undefined;
function tokenEndpoint(): Promise<string> {
  return (discovery ??= (async () => {
    try {
      const res = await fetch(new URL(".well-known/openid-configuration", ISSUER));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const doc = await res.json();
      if (typeof doc?.token_endpoint !== "string") {
        throw new Error("discovery-dokumentet saknar token_endpoint");
      }
      return doc.token_endpoint;
    } catch (err) {
      discovery = undefined;
      throw err;
    }
  })());
}

/**
 * Trade the refresh token for a new access token, and take the group list that
 * comes back — which is the point of doing it at all. Our access token opens
 * nothing; refreshing is how a mandate granted or revoked in Authentik reaches
 * this app within the hour instead of at the holder's next sign-in.
 *
 * On failure the session is marked errored rather than silently kept: a
 * refresh that stopped working usually means the session was revoked at the
 * other end, and continuing to honour it would be the app disagreeing with
 * Authentik about whether someone is still signed in.
 */
async function refreshAccessToken<T extends AppToken>(token: T): Promise<T> {
  if (!token.refresh_token) return { ...token, error: "RefreshTokenError" };

  try {
    const secret = serverEnv("AUTH_AUTHENTIK_CLIENT_SECRET");
    const body = new URLSearchParams({
      client_id: serverEnv("AUTH_AUTHENTIK_CLIENT_ID"),
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    });
    if (secret) body.set("client_secret", secret); // public clients have none

    const res = await fetch(await tokenEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokens = await res.json();
    if (!res.ok) throw new Error(tokens?.error_description ?? tokens?.error ?? res.statusText);

    const groups = groupsInAccessToken(tokens.access_token);
    if (groups && token.uid) await refreshRoles(token.uid, groups);

    return {
      ...token,
      expires_at: Math.floor(Date.now() / 1000) + Number(tokens.expires_in ?? 0),
      refresh_token: tokens.refresh_token ?? token.refresh_token,
      error: undefined,
    };
  } catch (err) {
    console.error("Kunde inte förnya Authentik-token:", err);
    return { ...token, error: "RefreshTokenError" };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  callbacks: {
    // Same rule as Auth.js's default, except "our own origin" means the host
    // this request actually arrived on — see requestOrigin above.
    async redirect({ url, baseUrl }) {
      const base = await requestOrigin(baseUrl);
      if (url.startsWith("/")) return `${base}${url}`;
      const origin = new URL(url).origin;
      return origin === base || origin === baseUrl ? url : base;
    },
    // Authentik only issues tokens to members of the section, so there is no
    // domain rule left to enforce — but an identity with no student id is one
    // we cannot key a row on, and every page after this would be answering
    // questions about a user that doesn't exist.
    async signIn({ user }) {
      return Boolean(user?.studentId);
    },
    // On sign-in, resolve (or provision) our DB user and stamp the id.
    //
    // The id and nothing that expires: roles used to be stamped here too, which
    // made the token an authority document with a 30-day life. They are read
    // from the database on every request now (lib/server/current-user.ts), so
    // this only has to say who signed in — the group list it carries is
    // bookkeeping for the refresh below, never an answer to "may they".
    async jwt({ token, user, account }) {
      // Same object, with our claims named — see AppToken.
      const t = token as typeof token & AppToken;

      // A sign-in is the only call where both of these are present.
      if (user && account) {
        t.provider = account.provider;

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
          t.refresh_token = account.refresh_token;
          t.expires_at = account.expires_at;
          return t;
        }

        // Dev provider: the row already exists and `authorize` found it.
        if (user.id) {
          t.uid = user.id;
          t.studentId = user.studentId;
          t.name = user.name;
          t.email = user.email;
        }
        return t;
      }

      // Nothing to keep fresh for a dev sign-in, and no refresh token to do it
      // with — asking would fail every request for the life of the session.
      if (t.provider !== "authentik") return t;
      if (t.expires_at && Date.now() < t.expires_at * 1000) return t;
      return refreshAccessToken(t);
    },
    async session({ session, token }) {
      const t = token as typeof token & AppToken;
      if (t.uid) {
        session.user.id = t.uid;
        session.user.studentId = t.studentId;
        if (t.name) session.user.name = t.name;
        if (t.email) session.user.email = t.email;
      }
      // Surfaced rather than acted on: a session callback cannot redirect, and
      // the app already has one place that decides an unusable session means
      // sign in again (lib/server/current-user.ts).
      session.error = t.error;
      return session;
    },
  },
});
