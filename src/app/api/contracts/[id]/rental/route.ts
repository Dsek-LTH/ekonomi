// Amend a rental until it is signed: the whole new-rental form again, everything replaced and the document redrawn. See canEditRental.
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

  // A title nobody renamed follows the renter; a typed one is kept.
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

    // Lines are replaced wholesale, not diffed: they have no identity worth keeping.
    await tx.rentalLine.deleteMany({ where: { contractId: contract.id } });
    await tx.rentalLine.createMany({
      data: rentalLines(d).map((l) => ({ ...l, contractId: contract.id })),
    });
  });

  // Redrawn here: a draft whose PDF disagrees with its row gets sent by mistake.
  const drawn = await storeContractDocument(contract.id, g.actor.id);
  if (!drawn.ok) {
    console.error(`[contracts] ${contract.id}: redraw after edit failed`, drawn);
    return fail(502, "contract.renderFailed");
  }

  return new Response(null, { status: 204 });
}
