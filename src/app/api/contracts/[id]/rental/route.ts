// Amend a rental while it is still a draft.
//
// After that the route refuses. Not because a signed row is sacred, but because
// once the contract has gone out the counterparty is reading a document, and
// changing what it says underneath them is the one edit that must not be
// possible. See canEditRental.
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateRental } from "@/lib/api/schemas/contract";
import { canEditRental } from "@/lib/contract/status";
import { storeContractDocument } from "@/lib/contract/document";
import { checkAvailability, nameShortfalls } from "@/lib/data/rental-availability";
import { rentalPricing } from "@/lib/contract/rental/pricing";
import { isoToDate } from "@/lib/domain/date";
import type { Prisma } from "@/lib/generated/prisma/client";

// PATCH /api/contracts/:id/rental
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      rental: { select: { contractId: true, pickupAt: true, returnAt: true } },
    },
  });
  if (!contract) return fail(404, "contract.notFound");
  if (!contract.rental) return fail(422, "contract.rentalNotFound");
  if (!canEditRental(contract.status)) return fail(409, "contract.rentalLocked");

  const parsed = await parseBody(req, UpdateRental);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // Checked against what the row will hold once this patch lands, not against
  // what was sent: moving only the pickup date past a return date already
  // stored is the same mistake as sending both the wrong way round.
  const pickup = d.pickupAt ?? isoDay(contract.rental.pickupAt);
  const back = d.returnAt ?? isoDay(contract.rental.returnAt);
  if (back < pickup) return fail(422, "contract.returnBeforePickup");

  // Against the lines and period the row will hold once this lands, and
  // excluding this contract, which would otherwise find its own lines and
  // report the gear as taken by itself.
  if (d.lines !== undefined || d.pickupAt !== undefined || d.returnAt !== undefined) {
    const lines =
      d.lines ??
      (await prisma.rentalLine.findMany({
        where: { contractId: contract.id },
        select: { itemId: true, quantity: true },
      }));
    const clashes = await checkAvailability({
      lines,
      period: { from: pickup, to: back },
      exclude: contract.id,
    });
    if (clashes.length > 0) {
      const named = await nameShortfalls(clashes);
      return fail(409, "contract.itemsUnavailable", {
        values: { items: named.map((n) => `${n.name} (${n.owned - n.booked}/${n.wanted})`).join(", ") },
      });
    }
  }

  const data: Prisma.RentalDetailsUpdateInput = {};
  if (d.pickupAt !== undefined) data.pickupAt = isoToDate(d.pickupAt)!;
  if (d.returnAt !== undefined) data.returnAt = isoToDate(d.returnAt)!;
  if (d.purpose !== undefined) data.purpose = d.purpose;
  if (d.place !== undefined) data.place = d.place;
  if (d.paymentDueAt !== undefined) data.paymentDueAt = isoToDate(d.paymentDueAt);

  // The rent follows the lines, because the discounts are on them. Worked out
  // from what the row will hold rather than patched on its own, so the three
  // stored figures cannot disagree with the lines they came from.
  if (d.lines !== undefined) {
    const pricing = rentalPricing(d.lines);
    data.subtotalOre = pricing.subtotalOre;
    data.discountOre = pricing.discountOre;
    data.priceOre = pricing.totalOre;
  }

  await prisma.$transaction(async (tx) => {
    await tx.rentalDetails.update({ where: { contractId: contract.id }, data });

    // The lines are replaced wholesale rather than diffed. A line has no
    // identity worth preserving: it is a description and three numbers, and the
    // screen edits the set as a unit, so matching them up by id would be work
    // in aid of nothing. Nothing points at a line except the contract itself.
    if (d.lines !== undefined) {
      await tx.rentalLine.deleteMany({ where: { contractId: contract.id } });
      await tx.rentalLine.createMany({
        data: d.lines.map((l, i) => ({
          contractId: contract.id,
          itemId: l.itemId ?? null,
          description: l.description,
          quantity: l.quantity,
          unitPriceOre: l.unitPriceOre,
          discountPercent: l.discountPercent,
          replacementValueOre: l.replacementValueOre,
          sortOrder: i,
        })),
      });
    }

    // The archive's own dates follow the rental's, so the list keeps agreeing
    // with the contract.
    if (d.pickupAt !== undefined || d.returnAt !== undefined) {
      await tx.contract.update({
        where: { id: contract.id },
        data: { validFrom: isoToDate(pickup), validTo: isoToDate(back) },
      });
    }
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

/** A stored timestamp as the ISO day it falls on, for comparing with input. */
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
