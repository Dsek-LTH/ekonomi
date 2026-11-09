// GET previews and keeps nothing; POST stores, replacing the previous rendering. A rendering is not evidence.
import { prisma } from "@/lib/server/db";
import { canManageRentals, canViewRentals } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { canEditRental } from "@/lib/contract/status";
import { renderContractDocument, storeContractDocument } from "@/lib/contract/document";
import type { DocumentFailure } from "@/lib/contract/document";

const failed = (f: DocumentFailure) => {
  switch (f.reason) {
    case "notFound":
      return fail(404, "contract.notFound");
    case "rentalNotFound":
      return fail(422, "contract.rentalNotFound");
    case "renderFailed":
      return fail(502, "contract.renderFailed");
    case "storeFailed":
      return fail(503, "contract.storeFailed");
  }
};

// GET /api/contracts/:id/document
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canViewRentals, "contract.noViewAccess");
  if (!g.ok) return g.res;

  // No scope filter: renderContractDocument answers rentalNotFound for anything but a rental, which is all the narrowest viewer may see.
  const drawn = await renderContractDocument(id);
  if (!drawn.ok) return failed(drawn);

  return new Response(new Uint8Array(drawn.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // Names non-members: never cached anywhere shared.
      "Cache-Control": "private, max-age=0, no-store",
      "Content-Disposition": `inline; filename="${encodeURIComponent(drawn.filename)}"`,
    },
  });
}

// POST /api/contracts/:id/document: redraw and archive.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: {
      id: true,
      rental: { select: { contractId: true } },
      agreement: { select: { contractId: true } },
      files: { select: { role: true } },
    },
  });
  if (!contract) return fail(404, "contract.notFound");
  if (!contract.rental || !contract.agreement) {
    return fail(422, "contract.rentalNotFound");
  }

  // Only until the signed copy is uploaded: redrawing would leave two versions with no sign of which was signed.
  if (!canEditRental(contract)) {
    return fail(409, "contract.rentalLocked");
  }

  const drawn = await storeContractDocument(contract.id, g.actor.id);
  if (!drawn.ok) return failed(drawn);

  return Response.json(drawn, { status: 201 });
}
