// Draw a contract's document.
//
// GET previews it and keeps nothing: the bytes stream straight back, so a
// reader can see what a draft looks like without a rendering landing in the
// archive. POST is the one that stores, replacing the previous rendering.
//
// The same split the utläggsräkning has, and for the same reason. A rendering
// is not evidence, so drawing one to look at costs nothing and archiving one is
// a deliberate act.
import { prisma } from "@/lib/server/db";
import { canManageContracts, canViewContracts } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { canEditRental } from "@/lib/contract/status";
import { renderContractDocument, storeContractDocument } from "@/lib/contract/document";
import type { DocumentFailure } from "@/lib/contract/document";

/** A failure reason as the message key that reads it back. */
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
  const g = await gate(canViewContracts, "contract.noViewAccess");
  if (!g.ok) return g.res;

  const drawn = await renderContractDocument(id);
  if (!drawn.ok) return failed(drawn);

  return new Response(new Uint8Array(drawn.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // A contract names people who are not members. Never cached anywhere
      // shared.
      "Cache-Control": "private, max-age=0, no-store",
      "Content-Disposition": `inline; filename="${encodeURIComponent(drawn.filename)}"`,
    },
  });
}

// POST /api/contracts/:id/document: redraw and archive.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!contract) return fail(404, "contract.notFound");

  // Only while it is a draft. After the contract has gone out, redrawing it
  // would leave two versions in the world with nothing saying which one the
  // counterparty put their name to. `replaceGeneratedFile` could not touch a
  // SIGNED file even if it were called, so this is the second lock rather than
  // the only one.
  if (!canEditRental(contract.status)) return fail(409, "contract.rentalLocked");

  const drawn = await storeContractDocument(contract.id, g.actor.id);
  if (!drawn.ok) return failed(drawn);

  return Response.json(drawn, { status: 201 });
}
