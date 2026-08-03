// Bucket access for standalone scripts (seed, gc-receipts).
//
// The app's own client lives in lib/server/storage.ts, but that module is
// `server-only` and reads config through lib/server/env.ts, which is too —
// neither can be imported from a tsx script. So the client is built again here,
// with the same dev fallbacks. Production sets every one of these explicitly.
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const env = (name: string, fallback: string) => process.env[name] || fallback;

export const bucket = () => env("S3_BUCKET", "receipts");

// Built on first use, not at import. A script calls `process.loadEnvFile()` in
// its module body, but static imports are hoisted and run first — a client
// constructed at import time would read the environment before the .env was in
// it, and quietly use the dev fallbacks against a production bucket name.
let client: S3Client | undefined;
function s3(): S3Client {
  client ??= new S3Client({
    endpoint: env("S3_ENDPOINT", "http://localhost:9000"),
    region: env("S3_REGION", "us-east-1"),
    // MinIO needs path-style addressing (bucket in the path, not the host).
    forcePathStyle: true,
    credentials: {
      accessKeyId: env("S3_ACCESS_KEY", "utlagg"),
      secretAccessKey: env("S3_SECRET_KEY", "utlagg-dev-secret"),
    },
  });
  return client;
}

export interface StoredObject {
  key: string;
  lastModified: Date;
  size: number;
}

// Every object in the bucket, following the 1000-per-response pagination.
export async function listObjects(prefix?: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let token: string | undefined;
  do {
    const res = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      out.push({
        key: obj.Key,
        lastModified: obj.LastModified ?? new Date(),
        size: obj.Size ?? 0,
      });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

const DELETE_BATCH = 1000; // S3's per-request limit for DeleteObjects

// Delete keys in batches. Returns the keys that could not be removed, so the
// caller can report them rather than claim a clean sweep it didn't get.
export async function deleteKeys(keys: string[]): Promise<{ key: string; message: string }[]> {
  const failures: { key: string; message: string }[] = [];
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const res = await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: keys.slice(i, i + DELETE_BATCH).map((Key) => ({ Key })) },
      }),
    );
    for (const err of res.Errors ?? []) {
      failures.push({ key: err.Key ?? "?", message: err.Message ?? "okänt fel" });
    }
  }
  return failures;
}
