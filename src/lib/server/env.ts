// Environment configuration, resolved and checked in one place.
// Fallbacks match docker-compose.yml so local dev is zero-config. They are dev-only: in production each
// variable must be set and the server refuses to start otherwise.
import "server-only";

import { S3_DEFAULTS } from "@/lib/s3-config";

export const isProduction = process.env.NODE_ENV === "production";

// `next build` runs with NODE_ENV=production on machines without production secrets, and imports modules
// that read this config at import, so the build gets the development fallbacks.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const mustBeConfigured = isProduction && !isBuildPhase;

// Required to run. The value is the local development fallback.
const REQUIRED = {
  DATABASE_URL: "postgresql://ekonomi:ekonomi@localhost:5432/ekonomi",
  // Links in mails, canonical URLs and the link preview image are built on it.
  APP_URL: "http://localhost:3000",
  // Signs the session JWTs. The fallback is a forgery key in production: generate with `openssl rand -base64 32`.
  AUTH_SECRET: "dev-only-insecure-auth-secret",

  // ── Object storage ── (from lib/s3-config.ts, which the standalone scripts read too)
  ...S3_DEFAULTS,

  // ── Authentik (sign-in) ── Same names as the guild's web app. The fallbacks are its public dev client
  // (no secret, localhost redirects only). A deployment registers its own application (redirect URI
  // `<origin>/api/auth/callback/authentik`) and sets all three.
  AUTH_AUTHENTIK_CLIENT_ID: "SvRybUTCGqhNiw2Y3gn1wqt0YxpjW2sv9fbPsUaP",
  AUTH_AUTHENTIK_CLIENT_SECRET: "",
  AUTH_AUTHENTIK_ISSUER: "https://auth.dsek.se/application/o/dev/",
} as const;

// The rest is optional and not checked: FORTNOX_CLIENT_ID/SECRET/REDIRECT_URI switch on Fortnox,
// FORTNOX_TOKEN_KEY encrypts stored tokens (falls back to AUTH_SECRET), ZETTLE_CLIENT_ID and ZETTLE_API_KEY
// switch on Zettle, SMTP_HOST switches on email (then MAIL_FROM is required: a made-up sender is binned),
// CRON_SECRET switches on the scheduled jobs under app/api/cron.

type RequiredVar = keyof typeof REQUIRED;

/** A required variable's value: what's set, or the development fallback. Throws in production when unset. */
export function serverEnv(name: RequiredVar): string {
  const value = process.env[name];
  if (value) return value;
  if (mustBeConfigured) {
    throw new Error(`${name} är inte satt. Se .env.example.`);
  }
  return REQUIRED[name];
}

/** Everything wrong with the environment, as a list. Empty in development. */
function envProblems(): string[] {
  if (!mustBeConfigured) return [];

  // Presence only: a value equal to the .env.example one is a plausible production answer.
  const missing: string[] = (Object.keys(REQUIRED) as RequiredVar[]).filter(
    (name) => !process.env[name],
  );
  // Optional as a group, required as a whole: half-configured mail leaves and is binned.
  if (process.env.SMTP_HOST && !process.env.MAIL_FROM) missing.push("MAIL_FROM");
  return missing.map((name) => `${name} saknas`);
}

/** Refuse to start a misconfigured production server. Called from instrumentation.ts at boot. */
export function assertServerEnv(): void {
  const problems = envProblems();
  if (problems.length === 0) return;
  throw new Error(
    `Kan inte starta: felaktig miljökonfiguration.\n  - ${problems.join("\n  - ")}\nSe .env.example för vad som krävs.`,
  );
}
