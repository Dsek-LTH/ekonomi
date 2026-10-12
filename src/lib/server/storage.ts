// Object storage for uploaded receipts. Talks to MinIO (S3-compatible) via the
// AWS SDK v3, so the same code works against MinIO now and any S3/R2 later by
// changing env vars. Receipt *bytes* live here; the *metadata* lives in Postgres
// (see the Receipt model). This is the "proxy" model: only the Next server
// reaches MinIO. It is never exposed to the browser.
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { s3ClientOptions } from "@/lib/s3-config";
import { serverEnv } from "@/lib/server/env";

const BUCKET = serverEnv("S3_BUCKET");

// How to reach the bucket is shared with the standalone scripts (see
// lib/s3-config.ts); *what happens when it isn't configured* is not, and that
// is the whole difference between the two callers. Here an unset variable in
// production is a refusal to start.
function createClient() {
  return new S3Client(s3ClientOptions(serverEnv));
}

// Singleton: avoids creating a new client per request under hot-reload.
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

// The rendered intäktsräkning for a day's takings. Kept under its own prefix
// rather than alongside receipts because it is generated rather than uploaded:
// re-rendering a report replaces the object at the same key, which a receipt
// never does.
export function incomeDocumentKey(reportId: string, filename: string): string {
  return `income/${reportId}/${safeName(filename)}`;
}

// The rendered utläggsräkning, the cover page naming who attested what. Its
// own prefix for the same reason as the income one: generated, not uploaded.
//
// The cover only. The receipt it fronts stays under `receipts/` and is joined
// to this on the way out (lib/server/pdf-merge.ts), so the bytes of an underlag
// are never held twice.
export function expenseDocumentKey(expenseId: string, filename: string): string {
  return `expenses/${expenseId}/${safeName(filename)}`;
}

// A file belonging to an avtal: an uploaded original, a rendered
// uthyrningsavtal, a signed PDF, the signing provider's evidence log.
//
// One prefix for all four rather than one each, because what a file *is* to its
// contract is ContractFile.role and belongs in the row, not in the key. A key
// that encoded it would have to be rewritten the day a GENERATED file becomes
// the SIGNED one, and rewriting a key means copying the bytes.
//
// The fileId (a cuid) carries uniqueness, so re-uploading a file of the same
// name never collides with the one already there. That matters more here than
// it does for receipts: a contract holds many files at once, and two of them
// really are often called scan.pdf.
export function contractFileKey(
  contractId: string,
  fileId: string,
  filename: string,
): string {
  return `contracts/${contractId}/${fileId}-${safeName(filename)}`;
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

interface ObjectStream {
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
// outlives the request, and the only way anyone learns that is this log line:
// the sweeper (scripts/gc-receipts.ts) collects what lands here.
export async function deleteObjectBestEffort(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (e) {
    console.error(`[storage] orphaned object: could not delete ${key}`, e);
  }
}

// Listing the bucket is the sweeper's business, and the sweeper has its own
// client (scripts/storage-admin.ts) because a tsx script cannot import a
// `server-only` module. There was a copy of it here too, unreachable from
// anything, under a comment saying the sweeper needed it.
