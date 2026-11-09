// Object storage (MinIO via the AWS SDK, so any S3 works). Receipt bytes live here, metadata in Postgres.
// Only the Next server reaches MinIO, never the browser.
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
import { safeName } from "@/lib/storage-keys";

const BUCKET = serverEnv("S3_BUCKET");

// An unset variable in production is a refusal to start (connection settings are shared with lib/s3-config.ts).
function createClient() {
  return new S3Client(s3ClientOptions(serverEnv));
}

const globalForS3 = globalThis as unknown as { s3?: S3Client };
const s3 = globalForS3.s3 ?? createClient();
if (process.env.NODE_ENV !== "production") globalForS3.s3 = s3;

// Create the bucket on first use, memoised per process.
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
      // Reset so a transient failure can retry.
      bucketReady = undefined;
      throw err;
    });
  }
  return bucketReady;
}

export { receiptKey } from "@/lib/storage-keys";

// The rendered intäktsräkning for a day's takings. Re-rendering replaces the object at the same key.
export function incomeDocumentKey(reportId: string, filename: string): string {
  return `income/${reportId}/${safeName(filename)}`;
}

// The rendered utläggsräkning (cover page only). Receipts stay under `receipts/` and are joined on the
// way out (lib/server/pdf-merge.ts).
export function expenseDocumentKey(expenseId: string, filename: string): string {
  return `expenses/${expenseId}/${safeName(filename)}`;
}

// A file belonging to an avtal (original, rendered, signed PDF, evidence log). One prefix for all roles,
// because the role lives in ContractFile.role and a key is never rewritten. The fileId carries uniqueness.
export function contractFileKey(contractId: string, fileId: string, filename: string): string {
  return `contracts/${contractId}/${fileId}-${safeName(filename)}`;
}

// A levfaktura's PDF or specification. The documentId carries uniqueness.
export function supplierInvoiceDocumentKey(
  invoiceId: string,
  documentId: string,
  filename: string,
): string {
  return `supplier-invoices/${invoiceId}/${documentId}-${safeName(filename)}`;
}

// A levfaktura document that arrived before any invoice was made from it (Inkorg upload or forwarded mail).
// Its key is kept when put on an invoice, since a key is never rewritten.
export function supplierInvoiceInboxKey(documentId: string, filename: string): string {
  return `supplier-invoices/inbox/${documentId}-${safeName(filename)}`;
}

// A member's profile picture. A new key per upload, so a browser holding the old versioned URL is never served the new bytes.
export function avatarObjectKey(userId: string, version: number): string {
  return `avatars/${userId}/${version}.webp`;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
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
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Empty object body for key ${key}`);
  return {
    // Web stream so it pipes into a Next Response unbuffered.
    body: (res.Body as { transformToWebStream(): ReadableStream }).transformToWebStream(),
    contentType: res.ContentType ?? "application/octet-stream",
    contentLength: res.ContentLength,
  };
}

// Read a whole object into memory, for handing the bytes to another API (e.g. Fortnox).
export async function getObjectBuffer(
  key: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Empty object body for key ${key}`);
  const arr = await (
    res.Body as { transformToByteArray(): Promise<Uint8Array> }
  ).transformToByteArray();
  return {
    bytes: Buffer.from(arr),
    contentType: res.ContentType ?? "application/octet-stream",
  };
}

// Remove an object, and throw if it is still there afterwards: the row is only dropped once the bytes are
// gone. An already absent object counts as success.
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return;
    throw e;
  }
}

// Delete without letting storage trouble block the caller (upload rollback only). A leftover object is
// collected by the sweeper (scripts/gc-receipts.ts).
export async function deleteObjectBestEffort(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (e) {
    console.error(`[storage] orphaned object: could not delete ${key}`, e);
  }
}
