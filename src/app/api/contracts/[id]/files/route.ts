// Upload onto a contract (browser to this route to MinIO). A person may upload ORIGINAL, ATTACHMENT or SIGNED; EVIDENCE is the signing provider's, so a form must not claim it.
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { canManageKind } from "@/lib/data/contract-scope";
import { fail, gate } from "@/lib/api/guard";
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";
import { storeContractFile } from "@/lib/contract/files";
import type { ContractFileRole } from "@/lib/domain/types";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_BODY_BYTES = MAX_BYTES + 1024 * 1024;

// SIGNED too: uploading the signed copy is what makes a contract Signerat.
const UPLOADABLE: readonly string[] = ["ORIGINAL", "SIGNED", "ATTACHMENT"];

// POST /api/contracts/:id/files: multipart form-data, field "file",
// optional field "role" (ORIGINAL by default).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, rental: { select: { contractId: true } } },
  });
  if (!contract) return fail(404, "contract.notFound");
  if (!canManageKind(g.actor, { hasRental: contract.rental !== null })) {
    return fail(403, "contract.noManageAccess");
  }

  // Before the body is touched: req.formData() reads the whole request into memory. Content-Length is the sender's claim, enough here.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail(413, "contract.fileSizeRange", { values: { max: MAX_BYTES } });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "request.expectedMultipart");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "request.noFile");
  if (file.size === 0 || file.size > MAX_BYTES) {
    return fail(413, "contract.fileSizeRange", { values: { max: MAX_BYTES } });
  }

  const asked = String(form.get("role") ?? "ORIGINAL");
  if (!UPLOADABLE.includes(asked)) return fail(422, "contract.fileRoleNotUploadable");
  const role = asked as ContractFileRole;

  // The file's type from its own first bytes; file.type is the client's claim and only used in the error message.
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const fileType = sniffReceiptType(head);
  if (!fileType) {
    return fail(415, "contract.fileUnsupportedType", { values: { type: file.type || "?" } });
  }

  // Stored as uploaded: a contract is the document itself, so re-encoding would break the recorded sha256.
  const bytes = Buffer.from(await file.arrayBuffer());

  const stored = await storeContractFile({
    contractId: contract.id,
    role,
    filename: file.name,
    mimeType: fileType,
    bytes,
    uploadedById: g.actor.id,
  });

  return Response.json(stored, { status: 201 });
}
