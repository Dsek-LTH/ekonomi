// Amend a rental until somebody has signed it.
//
// The whole form again, the same one the rental was drawn on, rather than a
// patch of the fields that changed: the edit screen is the new-rental form
// pre-filled, so it sends what that form sends. Everything the agreement says
// is replaced (the renter, the period, the gear, how many sign) and the
// document is redrawn.
//
// Once the signed copy is uploaded, the route refuses. Not because a signed
// row is sacred, but because the counterparty has put their name to a document by
// then, and changing what it says underneath them is the one edit that must not
// be possible. See canEditRental.
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { canManageKind } from "@/lib/data/contract-scope";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateRental } from "@/lib/api/schemas/contract";
import { canEditRental } from "@/lib/contract/status";
import { rentalTitle } from "@/lib/contract/signatory";
import { storeContractDocument } from "@/lib/contract/document";
import {
  agreementColumns,
  refuseRental,
  rentalColumns,
  rentalLines,
} from "@/lib/contract/rental/write";

// PUT /api/contracts/:id/rental
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      agreement: { select: { counterparty: true } },
      rental: { select: { contractId: true } },
      files: { select: { role: true } },
    },
  });
  if (!contract) return fail(404, "contract.notFound");
  if (!canManageKind(g.actor, { hasRental: contract.rental !== null })) {
    return fail(403, "contract.noManageAccess");
  }
  if (!contract.rental || !contract.agreement) return fail(422, "contract.rentalNotFound");
  if (!canEditRental(contract)) {
    return fail(409, "contract.rentalLocked");
  }

  const parsed = await parseBody(req, CreateRental);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const refused = await refuseRental(d, contract.id);
  if (refused) return refused;

  // A title nobody renamed follows the renter, so "Uthyrning till F-sektionen"
  // does not outlive a change of renter. One somebody typed is theirs to keep.
  const titleIsDerived =
    contract.agreement.counterparty !== null &&
    contract.title === rentalTitle(contract.agreement.counterparty);

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contract.id },
      data: {
        ...(titleIsDerived ? { title: rentalTitle(d.counterparty) } : {}),
        agreement: { update: agreementColumns(d) },
        rental: { update: rentalColumns(d) },
      },
    });

    // The lines are replaced wholesale rather than diffed. A line has no
    // identity worth preserving: it is a description and three numbers, and
    // the form edits the set as a unit, so matching them up by id would be
    // work in aid of nothing.
    await tx.rentalLine.deleteMany({ where: { contractId: contract.id } });
    await tx.rentalLine.createMany({
      data: rentalLines(d).map((l) => ({ ...l, contractId: contract.id })),
    });
  });

  // The stored document described the contract as it was. Redrawn here rather
  // than left for somebody to remember, because a draft whose PDF disagrees
  // with its row is exactly the document that gets sent out by mistake.
  const drawn = await storeContractDocument(contract.id, g.actor.id);
  if (!drawn.ok) {
    console.error(`[contracts] ${contract.id}: redraw after edit failed`, drawn);
    return fail(502, "contract.renderFailed");
  }

  return new Response(null, { status: 204 });
}
