// Auth.js (NextAuth v5) configuration. JWT sessions; the Google identity is
// mapped to our own User table (the source of truth for roles). Restricted to
// the @user.dsek.se Google Workspace domain. A dev-only credentials provider lets us
// sign in as a seeded user without Google credentials during local development.
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { prisma } from "@/lib/server/db";

const DOMAIN = "user.dsek.se";

const providers: NextAuthConfig["providers"] = [];

// Real Google sign-in (only registered when credentials are configured).
if (process.env.AUTH_GOOGLE_ID) {
  providers.push(
    Google({
      // `hd` nudges Google to the workspace domain; we still verify server-side.
      authorization: { params: { hd: DOMAIN, prompt: "select_account" } },
    }),
  );
}

// Dev-only: sign in as an existing @user.dsek.se user without Google.
if (process.env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: {} },
      // The user has to already exist. Auto-provisioning is Google's path
      // (see the jwt callback) — here it would mean a typo'd address signed
      // you in as nobody: the callback finds no row, stamps no id, and every
      // page bounces you back to /login with nothing said. Refusing the
      // sign-in outright is the same answer, given where it can be seen.
      authorize: async (creds) => {
        const email = String(creds?.email ?? "").toLowerCase();
        if (!email.endsWith(`@${DOMAIN}`)) return null;
        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true },
        });
        return user ? { id: user.id, email: user.email, name: user.name } : null;
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
    // Enforce the workspace domain for Google sign-ins.
    async signIn({ account, profile, user }) {
      if (account?.provider === "google") {
        const email = (profile?.email ?? user?.email ?? "").toLowerCase();
        const hd = (profile as { hd?: string } | undefined)?.hd;
        return hd === DOMAIN || email.endsWith(`@${DOMAIN}`);
      }
      return true; // dev provider — already domain-restricted + dev-only
    },
    // On sign-in, resolve (or auto-provision) our DB user and stamp the id.
    //
    // The id and nothing that expires: roles used to be stamped here too, which
    // made the token an authority document with a 30-day life. They are read
    // from the database on every request now (lib/server/current-user.ts), so
    // this only has to say who signed in.
    async jwt({ token, user, account }) {
      if (user?.email) {
        const email = user.email.toLowerCase();
        let dbUser = await prisma.user.findUnique({ where: { email } });
        if (!dbUser && account?.provider === "google") {
          dbUser = await prisma.user.create({
            data: { email, name: user.name ?? email, roles: ["ORDINARIE"] },
          });
        }
        if (dbUser) {
          token.uid = dbUser.id;
          token.name = dbUser.name;
          token.email = dbUser.email;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid as string;
        if (token.name) session.user.name = token.name as string;
        if (token.email) session.user.email = token.email as string;
      }
      return session;
    },
  },
});
