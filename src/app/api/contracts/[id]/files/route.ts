// Upload a document onto a contract: browser → this route → MinIO.
//
// The same proxy model receipts use, and deliberately the same shape of route,
// down to the order of the checks. What differs is that a contract holds many
// files rather than one, so an upload adds rather than replaces, and that the
// role it lands under is decided here rather than sent: everything a person
// uploads is an ORIGINAL or an ATTACHMENT, never a SIGNED one. Marking bytes as
// evidence is the signing provider's job (phase 3), and letting a form claim it
// would make the archive's strongest word its least trustworthy.
import { prisma } from "@/lib/server/db";
import { canManageContracts } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";
import { storeContractFile } from "@/lib/contract/files";
import type { ContractFileRole } from "@/lib/domain/types";

// A scanned contract is a bigger file than a receipt: more pages, and often
// scanned by whatever was in the copy room rather than by a phone.
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_BODY_BYTES = MAX_BYTES + 1024 * 1024;

/** What a person may file, and nothing else. See the note at the top. */
const UPLOADABLE: readonly string[] = ["ORIGINAL", "ATTACHMENT"];

// POST /api/contracts/:id/files: multipart form-data, field "file",
// optional field "role" (ORIGINAL by default).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!contract) return fail(404, "contract.notFound");

  // Before the body is touched: `req.formData()` reads the whole request into
  // memory, so a size check afterwards would protect the bucket and not the
  // server. Content-Length is the sender's claim, which is enough here, because
  // an honest one is refused for nothing and a dishonest one still meets the
  // real limit once the bytes are counted.
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

  // What the file *is*, from its own first bytes. `file.type` is the client's
  // claim about them and is never used for anything but the error message. The
  // sniffer is shared with receipts: it is named for them and is not about
  // them, it answers "which of these formats is this" and the answer set is the
  // same one, a PDF or a photograph of a piece of paper.
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const fileType = sniffReceiptType(head);
  if (!fileType) {
    return fail(415, "contract.fileUnsupportedType", { values: { type: file.type || "?" } });
  }

  // Stored as uploaded, with no normalisation. A receipt is downscaled because
  // it is a photo somebody took to prove a purchase; a contract is the document
  // itself, and re-encoding one would mean the bytes in the archive are not the
  // bytes that were handed over. The sha256 recorded beside it would then be a
  // hash of our rendering rather than of the thing.
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
