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
import { canManageRentals, canViewRentals } from "@/lib/domain/permissions";
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
  const g = await gate(canViewRentals, "contract.noViewAccess");
  if (!g.ok) return g.res;

  // No scope filter, and it is worth saying why rather than leaving the next
  // reader to work it out. A rental (a RentalDetails relation, not a kind of
  // its own — see prisma/schema/contract.prisma) is the only thing this app
  // draws a document for, `renderContractDocument` answers `rentalNotFound`
  // for anything else, and a rental is exactly what the narrowest viewer
  // here may see. So the gate and the renderer between them already close it.
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
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: {
      id: true,
      rental: { select: { contractId: true } },
      agreement: { select: { status: true } },
    },
  });
  if (!contract) return fail(404, "contract.notFound");
  // A rental is the only thing this app draws a document for, so the gate
  // above very nearly settles it. Asked anyway, because "the only thing
  // today" is not a thing to leave a route depending on. `status` is null
  // only for the OTHER-with-counterparty case that AgreementDetails now also
  // allows, which a rental can never be, so this doubles as the check that
  // narrows it for the compiler below.
  if (!contract.rental || !contract.agreement || contract.agreement.status === null) {
    return fail(422, "contract.rentalNotFound");
  }

  // Only while it is a draft. After the contract has gone out, redrawing it
  // would leave two versions in the world with nothing saying which one the
  // counterparty put their name to. `replaceGeneratedFile` could not touch a
  // SIGNED file even if it were called, so this is the second lock rather than
  // the only one.
  if (!canEditRental(contract.agreement.status)) return fail(409, "contract.rentalLocked");

  const drawn = await storeContractDocument(contract.id, g.actor.id);
  if (!drawn.ok) return failed(drawn);

  return Response.json(drawn, { status: 201 });
}
