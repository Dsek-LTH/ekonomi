// Bytes stream through this route so every read is authorised here and MinIO stays internal. Reading is CONTRACT_VIEW, removing is CONTRACT_MANAGE.
import { prisma } from "@/lib/server/db";
import { canManageRentals, canViewRentals } from "@/lib/domain/permissions";
import { canManageKind, contractScopeOf, contractScopeWhere } from "@/lib/data/contract-scope";
import { fail, gate } from "@/lib/api/guard";
import { getObjectStream } from "@/lib/server/storage";
import { deleteContractFile } from "@/lib/contract/files";

// GET /api/contracts/:id/files/:fileId: streams the PDF or image back inline.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await ctx.params;
  const g = await gate(canViewRentals, "contract.noViewAccess");
  if (!g.ok) return g.res;

  // Both ids (a file id must not be readable through another contract's URL) and the viewer's scope (a rental-only holder must not stream a sponsoravtal).
  const file = await prisma.contractFile.findFirst({
    where: {
      id: fileId,
      contractId: id,
      contract: contractScopeWhere(contractScopeOf(g.actor)),
    },
    select: { id: true, objectKey: true, filename: true },
  });
  if (!file) return fail(404, "contract.fileNotFound");

  // Storage unreachable is an outage; an object storage says is missing is a lost agreement, which somebody has to know.
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
    // Names non-members and binds the section: never cached anywhere shared.
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
    // A signed file is evidence and no screen may remove it (rule in lib/contract/files.ts).
    return removed.reason === "fileImmutable"
      ? fail(409, "contract.fileImmutable")
      : fail(404, "contract.fileNotFound");
  }

  return new Response(null, { status: 204 });
}
