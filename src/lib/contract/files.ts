// Putting a file on a contract and taking one off. Rule for every caller: a SIGNED file is
// never overwritten and signing evidence is never deleted.
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

interface StoredContractFile {
  id: string;
  role: ContractFileRole;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

/** Write bytes to the bucket and record the row, or leave neither behind. Object first, so an orphan is collectable (scripts/gc-receipts.ts). */
export async function storeContractFile(args: {
  contractId: string;
  role: ContractFileRole;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  uploadedById: string | null;
}): Promise<StoredContractFile> {
  const { contractId, role, filename, mimeType, bytes, uploadedById } = args;

  // Part of the object key, so it is drawn before the row exists. A uuid, as for receipts.
  const id = randomUUID();
  const objectKey = contractFileKey(contractId, id, filename);

  // Computed while the bytes are in memory, to avoid reading the object back.
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
    // Already failing: sweep best effort, the sweeper collects the rest.
    await deleteObjectBestEffort(objectKey);
    throw err;
  }
}

/** Why a file could not be removed. Maps to a message key under `errors.contract`. */
type DeleteFailure = "fileNotFound" | "fileImmutable";

/** Remove a file: bytes first, then the row. `deleteObject` throws, so a half-failure leaves a visible row without a document, never orphaned bytes. */
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

/** Replace the rendered contract, keeping one GENERATED file. Never touches a SIGNED file, so re-rendering a signed contract is safe. */
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

  // After the new one is down, best effort: a stale object is the sweeper's problem.
  for (const f of stale) {
    await prisma.contractFile.delete({ where: { id: f.id } });
    await deleteObjectBestEffort(f.objectKey);
  }

  return stored;
}
