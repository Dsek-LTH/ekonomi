// Putting a file on a contract, and taking one off again.
//
// The upload route could do this inline, the way the receipt one does, and for
// a while it should have. It is here instead because of one rule that has to
// hold in every caller and would otherwise be re-stated in each: a SIGNED file
// is evidence and nothing in this app may overwrite or delete it.
//
// That rule is cheap to write and easy to forget, and the place it gets
// forgotten is the second caller. Phase 3 adds two more (the webhook that
// stores the sealed PDF, and whatever re-renders a draft), so it lives in one
// module now, before there are three copies of it.
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/server/db";
import {
  contractFileKey,
  deleteObject,
  deleteObjectBestEffort,
  putObject,
} from "@/lib/server/storage";
import { isImmutable } from "@/lib/contract/file-roles";
import type { ContractFileRole } from "@/lib/domain/types";

export interface StoredContractFile {
  id: string;
  role: ContractFileRole;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

/**
 * Write bytes to the bucket and record the row, or leave neither behind.
 *
 * Object first, row second, and the object is swept if the row does not land.
 * The same order every upload in this app uses, for the same reason: an orphan
 * object is collectable (scripts/gc-receipts.ts finds one), and an orphan row
 * is a document the app offers and cannot open.
 */
export async function storeContractFile(args: {
  contractId: string;
  role: ContractFileRole;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  uploadedById: string | null;
}): Promise<StoredContractFile> {
  const { contractId, role, filename, mimeType, bytes, uploadedById } = args;

  // The id is drawn here rather than by the database, because it is part of the
  // object key and the key has to be known before there is a row to read it
  // from. A uuid, the same as a receipt's, and for the same reason: it is the
  // half of the key that guarantees two files called scan.pdf never collide.
  const id = randomUUID();
  const objectKey = contractFileKey(contractId, id, filename);

  // While the bytes are already in memory. Computing this later would mean
  // reading the whole object back out of MinIO to learn something we were
  // holding a moment ago, and skipping it means the archive can never answer
  // "is this the file that was signed" for anything filed before somebody
  // thought to ask.
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await putObject(objectKey, bytes, mimeType);
  try {
    const row = await prisma.contractFile.create({
      data: {
        id,
        contractId,
        role,
        objectKey,
        filename,
        mimeType,
        byteSize: bytes.length,
        sha256,
        uploadedById,
      },
      select: {
        id: true,
        role: true,
        filename: true,
        mimeType: true,
        byteSize: true,
        sha256: true,
      },
    });
    return row;
  } catch (err) {
    // The request is already failing and there is no useful way to report a
    // second problem behind the first, so the object is swept best-effort and
    // the sweeper collects whatever that could not reach.
    await deleteObjectBestEffort(objectKey);
    throw err;
  }
}

/** Why a file could not be removed. Maps to a message key under
 *  `errors.contract`, so a route hands it straight to `fail()`. */
export type DeleteFailure = "fileNotFound" | "fileImmutable";

/**
 * Remove a file from a contract: the bytes first, then the row.
 *
 * That order is the one thing worth being careful about. Dropping the row first
 * and failing on the object leaves bytes nothing points at, which nothing will
 * ever find again; dropping the object first and failing on the row leaves a
 * row whose document is gone, which the next reader sees immediately and can
 * say so. `deleteObject` throws rather than failing quietly, which is what
 * makes the second case the only one that can happen.
 */
export async function deleteContractFile(
  fileId: string,
): Promise<{ ok: true } | { ok: false; reason: DeleteFailure }> {
  const file = await prisma.contractFile.findUnique({
    where: { id: fileId },
    select: { id: true, role: true, objectKey: true },
  });
  if (!file) return { ok: false, reason: "fileNotFound" };
  if (isImmutable(file.role)) return { ok: false, reason: "fileImmutable" };

  await deleteObject(file.objectKey);
  await prisma.contractFile.delete({ where: { id: file.id } });
  return { ok: true };
}

/**
 * Replace the rendered contract, keeping one GENERATED file rather than a pile
 * of them.
 *
 * A rendering is not evidence: draw it again from the same row and the same
 * bytes come back, so the previous one is a stale copy rather than a record.
 * The one that is kept is the one the counterparty will be sent.
 *
 * Nothing here can touch a SIGNED file, because it only ever looks at
 * GENERATED ones. That is deliberate, and it is why re-rendering a contract
 * that has already been signed is safe: the signed PDF is a different row with
 * a different role and this never sees it.
 */
export async function replaceGeneratedFile(args: {
  contractId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  uploadedById: string | null;
}): Promise<StoredContractFile> {
  const stale = await prisma.contractFile.findMany({
    where: { contractId: args.contractId, role: "GENERATED" },
    select: { id: true, objectKey: true },
  });

  const stored = await storeContractFile({ ...args, role: "GENERATED" });

  // After the new one is safely down, so a failure here leaves two renderings
  // rather than none. Best-effort for the same reason: the caller has what it
  // asked for, and a stale object nothing points at is the sweeper's problem,
  // not this request's.
  for (const f of stale) {
    await prisma.contractFile.delete({ where: { id: f.id } });
    await deleteObjectBestEffort(f.objectKey);
  }

  return stored;
}
