// S3 settings shared by the app and the tsx scripts (which cannot import `server-only` modules).
// Deliberately not `server-only`.

/** Local-dev fallbacks matching docker-compose MinIO. lib/server/env.ts refuses them in production. */
export const S3_DEFAULTS = {
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "receipts",
  S3_ACCESS_KEY: "ekonomi",
  S3_SECRET_KEY: "ekonomi-dev-secret",
} as const;

export type S3Var = keyof typeof S3_DEFAULTS;

/** S3Client options; `read` is the caller's setting reader (the app throws in production, scripts use the fallback). */
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
