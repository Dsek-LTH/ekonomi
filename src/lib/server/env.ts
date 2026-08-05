// Environment configuration, resolved and checked in one place.
//
// Local development is meant to be zero-config: the fallbacks below match
// docker-compose.yml, so `pnpm db:up && pnpm dev` works with an empty .env.
// In production those same fallbacks are exactly the wrong behaviour — an unset
// S3_ENDPOINT would quietly point the app at a MinIO that isn't there, and the
// first person to upload a receipt would find that out, hours after the deploy
// went green. So every fallback is dev-only: in production each variable must
// say what it means, and the server refuses to start until it does.
//
// Read through `serverEnv` rather than `process.env` directly, so there is one
// answer to "what is this set to, and what happens when it isn't".
import "server-only";

const isProduction = process.env.NODE_ENV === "production";

// `next build` runs with NODE_ENV=production but on a machine that has no
// business holding production secrets — a CI runner, or a Docker build step.
// It imports the modules that read this config (the Prisma client and the S3
// client are both created at import), so a build would demand a database URL it
// will never connect to. Nothing may legitimately reach a database or a bucket
// at build time, so the build gets the development fallbacks; `assertServerEnv`
// still refuses to let a real server start without the real values.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const mustBeConfigured = isProduction && !isBuildPhase;

// Required to run. The value is what local development falls back to; in
// production there is no fallback and the variable must be set.
const REQUIRED = {
  DATABASE_URL: "postgresql://utlagg:utlagg@localhost:5432/utlagg",
  // Signs the session JWTs. A known constant is fine on a laptop and is a
  // forgery key on the internet — and since the check below only asks whether
  // a value is set, nothing stops a deploy that kept this one. Generating it
  // is the deploy's job: `openssl rand -base64 32`.
  AUTH_SECRET: "dev-only-insecure-auth-secret",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "receipts",
  S3_ACCESS_KEY: "utlagg",
  S3_SECRET_KEY: "utlagg-dev-secret",

  // ── Authentik (sign-in) ──
  // Same names the guild's own web app uses, so a value copied from there
  // lands under the name it left. The fallbacks are their public development
  // client: it has no secret and Authentik only accepts localhost redirects
  // for it, which is what makes publishing it here harmless and what makes it
  // useless in production. A deployment registers its own application in
  // Authentik (redirect URI `<origin>/api/auth/callback/authentik`) and sets
  // all three — the check below refuses to start a production server that
  // didn't, since sign-in is the only way in once the dev provider is gone.
  AUTH_AUTHENTIK_CLIENT_ID: "SvRybUTCGqhNiw2Y3gn1wqt0YxpjW2sv9fbPsUaP",
  AUTH_AUTHENTIK_CLIENT_SECRET: "",
  AUTH_AUTHENTIK_ISSUER: "https://auth.dsek.se/application/o/dev/",
} as const;

// The rest of the environment is genuinely optional, and running without it is
// a supported way to run rather than a misconfiguration — so nothing here
// checks for it. FORTNOX_CLIENT_ID, FORTNOX_CLIENT_SECRET and
// FORTNOX_REDIRECT_URI switch the Fortnox integration on (lib/fortnox reads
// them where it needs them), and FORTNOX_TOKEN_KEY encrypts the stored tokens,
// falling back to AUTH_SECRET (lib/server/secrets.ts).
// They are all listed in .env.example, which is where someone setting the app
// up will look.
//
// Authentik needs nothing beyond the three above: the endpoints it uses are
// read from the issuer's discovery document rather than configured (auth.ts).

export type RequiredVar = keyof typeof REQUIRED;

/**
 * A required variable's value: what's set, or the development fallback.
 * Throws in production when it is unset — but `assertServerEnv` below has
 * normally already refused to start the server by then.
 */
export function serverEnv(name: RequiredVar): string {
  const value = process.env[name];
  if (value) return value;
  if (mustBeConfigured) {
    throw new Error(`${name} är inte satt. Se .env.example.`);
  }
  return REQUIRED[name];
}

/**
 * Everything wrong with the environment, as a list rather than one item at a
 * time — a deploy that is missing four variables should say so once, instead of
 * being restarted four times.
 *
 * Empty in development: the fallbacks above are what "unset" means there.
 */
function envProblems(): string[] {
  if (!mustBeConfigured) return [];

  // Presence, and nothing else. This used to also refuse a variable still set
  // to the value .env.example documents, which sounds like the same check and
  // is not: it cannot tell "never filled in" from "filled in with a name that
  // happens to be the obvious one", and most of these have an obvious one. A
  // bucket called `receipts` in a region called `us-east-1` is a plausible
  // production answer, and refusing to boot over it taught people that the
  // startup check cries wolf — which is the last thing a check like this can
  // afford. What a value should be is .env.example's job to say.
  return (Object.keys(REQUIRED) as RequiredVar[])
    .filter((name) => !process.env[name])
    .map((name) => `${name} saknas`);
}

/**
 * Refuse to start a misconfigured production server. Called from
 * instrumentation.ts, which runs once when the server boots — so the failure
 * lands in the deploy log, not in a receipt upload three hours later.
 */
export function assertServerEnv(): void {
  const problems = envProblems();
  if (problems.length === 0) return;
  throw new Error(
    `Kan inte starta: felaktig miljökonfiguration.\n  - ${problems.join("\n  - ")}\nSe .env.example för vad som krävs.`,
  );
}
