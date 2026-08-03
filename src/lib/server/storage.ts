// Object storage for uploaded receipts. Talks to MinIO (S3-compatible) via the
// AWS SDK v3, so the same code works against MinIO now and any S3/R2 later by
// changing env vars. Receipt *bytes* live here; the *metadata* lives in Postgres
// (see the Receipt model). This is the "proxy" model: only the Next server
// reaches MinIO — it is never exposed to the browser.
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { serverEnv } from "@/lib/server/env";

const BUCKET = serverEnv("S3_BUCKET");

function createClient() {
  return new S3Client({
    endpoint: serverEnv("S3_ENDPOINT"),
    region: serverEnv("S3_REGION"),
    // MinIO needs path-style addressing (bucket in the path, not the host).
    forcePathStyle: true,
    credentials: {
      accessKeyId: serverEnv("S3_ACCESS_KEY"),
      secretAccessKey: serverEnv("S3_SECRET_KEY"),
    },
  });
}

// Singleton — avoids creating a new client per request under hot-reload.
const globalForS3 = globalThis as unknown as { s3?: S3Client };
const s3 = globalForS3.s3 ?? createClient();
if (process.env.NODE_ENV !== "production") globalForS3.s3 = s3;

// Create the bucket on first use if it doesn't exist. Memoised so the
// round-trip happens once per process, not on every upload.
let bucketReady: Promise<void> | undefined;
function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
      } catch {
        await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      }
    })().catch((err) => {
      // Reset so a transient failure (e.g. MinIO still booting) can retry.
      bucketReady = undefined;
      throw err;
    });
  }
  return bucketReady;
}

// Strip directories and unsafe characters from a user-supplied filename.
function safeName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "file";
}

// Stable, collision-free key. The receiptId (a uuid) guarantees uniqueness;
// the expenseId prefix keeps a receipt's objects grouped.
export function receiptKey(
  expenseId: string,
  receiptId: string,
  filename: string,
): string {
  return `receipts/${expenseId}/${receiptId}-${safeName(filename)}`;
}

// Key for a receipt's thumbnail, alongside its full-size object.
export function receiptThumbKey(expenseId: string, receiptId: string): string {
  return `receipts/${expenseId}/${receiptId}-thumb.jpg`;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export interface ObjectStream {
  body: ReadableStream;
  contentType: string;
  contentLength?: number;
}

export async function getObjectStream(key: string): Promise<ObjectStream> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  if (!res.Body) throw new Error(`Empty object body for key ${key}`);
  return {
    // Web stream so it pipes straight into a Next Response with no buffering.
    body: (res.Body as { transformToWebStream(): ReadableStream }).transformToWebStream(),
    contentType: res.ContentType ?? "application/octet-stream",
    contentLength: res.ContentLength,
  };
}

// Read a whole object into memory. Used when we must hand the bytes to another
// API (e.g. uploading a receipt to Fortnox) rather than stream to the browser.
export async function getObjectBuffer(
  key: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Empty object body for key ${key}`);
  const arr = await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  return {
    bytes: Buffer.from(arr),
    contentType: res.ContentType ?? "application/octet-stream",
  };
}

// Remove an object, and throw if it is still there afterwards. Callers that
// delete a receipt depend on this refusing quietly to fail: the row is only
// dropped once the bytes are gone, so a raised error here is what keeps the
// bucket from outliving the database.
//
// An object that was already absent is the state we were asking for, so it
// counts as success rather than as the caller's problem. (S3 itself answers a
// delete of a missing key with 204; this tolerates backends that don't.)
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return;
    throw e;
  }
}

// Delete without letting storage trouble block the caller. Only for the upload
// rollback, where the request is already failing and there is no useful way to
// tell the user about a second problem behind the first. The object then
// outlives the request, and the only way anyone learns that is this log line —
// the sweeper (prisma/gc-receipts.ts) collects what lands here.
export async function deleteObjectBestEffort(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (e) {
    console.error(`[storage] orphaned object: could not delete ${key}`, e);
  }
}

// Every key in the bucket, following the 1000-per-response pagination. Only the
// sweeper needs this — the app addresses objects by the key stored on the row.
export async function listAllKeys(prefix?: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
