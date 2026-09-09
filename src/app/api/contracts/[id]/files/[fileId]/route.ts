// Serve or remove one file on a contract. The bytes stream
// browser ← Next ← MinIO, so every read is authorised here and MinIO stays
// internal.
//
// Reading is CONTRACT_VIEW and removing is CONTRACT_MANAGE, which is the one
// place the two capabilities visibly do different work. A resultatansvarig may
// read the agreement their unit is spending against; taking the document out of
// the archive is somebody else's call.
import { prisma } from "@/lib/server/db";
import { canManageRentals, canViewRentals } from "@/lib/domain/permissions";
import { canManageKind, contractScopeOf, contractScopeWhere } from "@/lib/data/contract-scope";
import { fail, gate } from "@/lib/api/guard";
import { getObjectStream } from "@/lib/server/storage";
import { deleteContractFile } from "@/lib/contract/files";

// GET /api/contracts/:id/files/:fileId: streams the PDF or image back inline.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await ctx.params;
  const g = await gate(canViewRentals, "contract.noViewAccess");
  if (!g.ok) return g.res;

  // Three conditions, all of them load-bearing. Both ids, so a file id from one
  // contract cannot be read through another's URL. And the viewer's scope, so a
  // rental-only holder cannot stream a sponsoravtal by knowing its id: this is
  // the route that hands over the bytes, and a gate that only guarded the page
  // would be a lock on the door of an open window.
  const file = await prisma.contractFile.findFirst({
    where: {
      id: fileId,
      contractId: id,
      contract: contractScopeWhere(contractScopeOf(g.actor)),
    },
    select: { id: true, objectKey: true, filename: true },
  });
  if (!file) return fail(404, "contract.fileNotFound");

  // Two very different failures, told apart deliberately, the same way the
  // receipt route tells them apart. Storage being unreachable is an outage the
  // rest of the app carries on through; an object storage says is not there is
  // an agreement that has gone missing, and somebody has to know.
  let obj;
  try {
    obj = await getObjectStream(file.objectKey);
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") {
      console.error(`[contracts] file ${file.id}: object ${file.objectKey} is gone`, e);
      return fail(404, "contract.fileMissing");
    }
    console.error(`[contracts] file ${file.id}: storage unreachable`, e);
    return fail(503, "contract.storageUnavailable");
  }

  const headers = new Headers({
    "Content-Type": obj.contentType,
    // An avtal names people who are not members and terms the section is bound
    // by. Never cached anywhere shared.
    "Cache-Control": "private, max-age=0, no-store",
    "Content-Disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
  });
  if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
  return new Response(obj.body, { headers });
}

// DELETE /api/contracts/:id/files/:fileId
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const file = await prisma.contractFile.findFirst({
    where: { id: fileId, contractId: id },
    select: { id: true, contract: { select: { rental: { select: { contractId: true } } } } },
  });
  if (!file) return fail(404, "contract.fileNotFound");
  if (!canManageKind(g.actor, { hasRental: file.contract.rental !== null })) {
    return fail(403, "contract.noManageAccess");
  }

  const removed = await deleteContractFile(file.id);
  if (!removed.ok) {
    // A signed file is evidence and there is no screen that may remove it. The
    // rule lives in lib/contract/files.ts; this is only how it reads back.
    return removed.reason === "fileImmutable"
      ? fail(409, "contract.fileImmutable")
      : fail(404, "contract.fileNotFound");
  }

  return new Response(null, { status: 204 });
}
