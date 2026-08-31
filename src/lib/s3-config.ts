// How to reach the receipt bucket, in the one place both callers can read it.
//
// There are two S3 clients in this repo and there have to be: the app's
// (lib/server/storage.ts) goes through lib/server/env.ts, and both of those are
// `server-only`, which a tsx script cannot import, so the seed and the sweeper
// build their own (prisma/storage-admin.ts). That much is unavoidable.
//
// What was avoidable was each of them carrying its own copy of the endpoint,
// the region, the addressing mode and the development credentials. Two copies
// of `utlagg-dev-secret` in a repo is two chances for them to stop agreeing,
// and the failure that produces is a script quietly reading a different bucket
// than the app writes to. The settings live here; the two clients differ only
// in how they read the environment, which is the part that genuinely differs.
//
// Deliberately not `server-only`: that is the point of the file.

/**
 * What each S3 setting falls back to in local development: the values
 * docker-compose.yml starts MinIO with, so `pnpm db:up && pnpm dev` needs no
 * configuration at all.
 *
 * These are development fallbacks and nothing else. lib/server/env.ts refuses
 * to start a production server that has not set every one of them for real.
 */
export const S3_DEFAULTS = {
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "receipts",
  S3_ACCESS_KEY: "utlagg",
  S3_SECRET_KEY: "utlagg-dev-secret",
} as const;

export type S3Var = keyof typeof S3_DEFAULTS;

/**
 * Constructor options for an `S3Client`, given a way to read a setting.
 *
 * The reader is the argument because that is the one thing the two callers
 * disagree about: the app's throws in production rather than fall back to a
 * MinIO that isn't there, and a standalone script's takes the fallback and
 * carries on.
 */
export function s3ClientOptions(read: (name: S3Var) => string) {
  return {
    endpoint: read("S3_ENDPOINT"),
    region: read("S3_REGION"),
    // MinIO needs path-style addressing (bucket in the path, not the host).
    forcePathStyle: true,
    credentials: {
      accessKeyId: read("S3_ACCESS_KEY"),
      secretAccessKey: read("S3_SECRET_KEY"),
    },
  };
}
