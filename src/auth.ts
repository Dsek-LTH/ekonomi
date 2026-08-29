// Auth.js (NextAuth v5) configuration. JWT sessions; sign-in goes through the
// guild's Authentik (auth.dsek.se), which is also where Google sits — federated
// upstream, so this app never sees a Google client. Same arrangement as the
// guild's own web app (Dsek-LTH/web, src/hooks.server.ts): one identity
// provider, one place a mandate is granted or revoked.
//
// The Authentik identity is mapped onto our own User row, keyed on the student
// id (`preferred_username`). Roles — and the result units a person answers for
// — are derived from the Authentik group list (lib/server/authentik-roles.ts)
// and written to that row: the row, not the token, is what every authority
// question is answered from. That happens at sign-in and only at sign-in, which
// is what fixes the length of a session — see `session` below, which is the
// comment to read before adding anything to this token.
//
// A dev-only credentials provider signs in as a seeded user without reaching
// Authentik at all.
import NextAuth, { type NextAuthConfig } from "next-auth";
import Authentik, { type AuthentikProfile } from "next-auth/providers/authentik";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { prisma } from "@/lib/server/db";
import { serverEnv } from "@/lib/server/env";
import { grantsFromGroups, sectionGroups } from "@/lib/server/authentik-roles";

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
 *
 * Note what is also not here any more: a refresh token, an expiry to compare it
 * against, and an error to report when the trade failed. Nothing mutable can
 * live in this token, for the reason set out above `session` below — so what is
 * left is what was true at sign-in and will still be true when the session ends.
 */
type AppToken = {
  /** Our User.id — the only identity claim the app acts on. */
  uid?: string;
  studentId?: string;
  name?: string | null;
  email?: string | null;
};

// `offline_access` is what gets us a refresh token, and `splitname` is what
// makes Authentik send given_name/family_name separately. Both are the guild's
// scopes, verbatim — an app asking for less would get a profile shaped
// differently from the one their code documents.
//
// The refresh token that first scope buys is no longer stored or spent (see
// `session` below). Kept anyway: dropping it is a change to what we ask the
// section's identity provider for, against a client registration shared with
// the guild's own app, and it buys nothing here. It is one word to remove the
// day nobody is going to want it back.
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
 * Roles and result units are overwritten from the group list, deliberately:
 * Authentik is the register of who holds which post, so a mandate that ended
 * there has ended here by the holder's next sign-in without anybody
 * remembering to do it. The consequence is that neither is editable in this app
 * at all — the place to change who holds a post is Authentik. What a post
 * *confers* is editable, in Inställningar → Roller, and is what the derivation
 * this calls reads (lib/server/authentik-roles.ts).
 *
 * The group list itself is stored alongside them, filtered to the section's own
 * groups. It is not authority and nothing gates on it — it is the evidence the
 * two columns beside it were derived from, kept so that an edit to the mapping
 * can re-derive this person without waiting for them to come back.
 */
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

/**
 * How long a sign-in lasts, absolutely — not from the last request, from the
 * sign-in itself. There is no rolling window available to us: extending one
 * means writing the cookie again, and see below for why we cannot.
 *
 * A day, because it is also the freshness of every mandate in the app. Grants
 * are re-derived from Authentik's group list at sign-in and nowhere else, so
 * this number is the longest a post revoked in Authentik keeps working here.
 * Thirty days — the Auth.js default this replaces — was a month, which for an
 * app that moves the section's money is not a number anybody would have chosen
 * on purpose.
 */
const SESSION_MAX_AGE = 24 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  /**
   * A JWT, and a strictly immutable one: it is written when you sign in and
   * never again for the life of the session.
   *
   * Not a preference — a constraint, and one worth writing down because the
   * code that ignored it looked completely reasonable. `auth()` is called from
   * Server Components (lib/server/current-user.ts), and next-auth's RSC branch
   * (next-auth/lib/index.js, `if (!args.length)`) drops the Set-Cookie headers
   * the session response carries; every other branch forwards them. It has to —
   * a Server Component renders after the headers are sent.
   *
   * So anything this token carries that is supposed to change over time cannot.
   * There used to be an OAuth refresh in the `jwt` callback below, trading the
   * refresh token for a fresh access token every few minutes to pick up group
   * changes. It read the rotated token back into a `token` object that was then
   * thrown away, so the cookie kept the spent one, and Authentik — which
   * invalidates a refresh token once it is used — refused every attempt after
   * the first. That was reported as `RefreshTokenError`, which the app honestly
   * treated as "Authentik says this session is over", and signed the reader out.
   * Every few minutes, for everyone, in production.
   *
   * The fix is not to make the write work. It is that a session cookie is the
   * wrong place for state that changes: authority is already read from the
   * database on every request (lib/server/current-user.ts, lib/api/guard.ts),
   * and what remains in here is identity, which does not expire before the
   * session does.
   */
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
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
    // made the token an authority document with a month's life. They are read
    // from the database on every request now (lib/server/current-user.ts), so
    // this only has to say who signed in — the group list it carries is spent
    // on the way past, deriving the grants written to that row, and never an
    // answer to "may they".
    //
    // A sign-in is also the only call this does anything on. On every other one
    // it hands the token back untouched, because a change it made there could
    // not be saved — see `session` above.
    async jwt({ token, user, account }) {
      // Same object, with our claims named — see AppToken.
      const t = token as typeof token & AppToken;

      // A sign-in is the only call where both of these are present.
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

        // Dev provider: the row already exists and `authorize` found it.
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
