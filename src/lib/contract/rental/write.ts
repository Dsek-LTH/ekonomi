// What drawing an uthyrningsavtal and amending one have in common.
//
// The edit screen is the new-rental form pre-filled, so the create route and
// the edit route take the same body. They refuse the same things for the same
// reasons and write the same columns, and both get them from here so the two
// cannot drift apart.
import "server-only";

import { prisma } from "@/lib/server/db";
import { fail } from "@/lib/api/guard";
import { checkAvailability, nameShortfalls } from "@/lib/data/rental-availability";
import { isoToDate } from "@/lib/domain/date";
import { rentalPricing } from "./pricing";
import type { CreateRental } from "@/lib/api/schemas/contract";

/**
 * What the schema cannot see about a rental, as the response refusing it, or
 * null when there is nothing to refuse.
 *
 * `exclude` is the contract being amended. Without it, its own lines would
 * report the gear as taken by itself.
 */
export async function refuseRental(d: CreateRental, exclude?: string): Promise<Response | null> {
  // A period that ends before it starts is not a rental anybody meant. Checked
  // as ISO days, which sort lexically, so no timezone is involved.
  if (d.returnAt < d.pickupAt) return fail(422, "contract.returnBeforePickup");

  // Catalogue ids are checked before anything is written. An id that names no
  // item would otherwise be silently dropped by the SetNull relation, and the
  // line would lose the only trail back to what it was drawn from.
  const itemIds = [
    ...new Set(d.lines.map((l) => l.itemId).filter((v): v is string => Boolean(v))),
  ];
  if (itemIds.length > 0) {
    const known = await prisma.rentalItem.count({ where: { id: { in: itemIds } } });
    if (known !== itemIds.length) return fail(422, "contract.itemNotFound");
  }

  // Same check, same reason, for the directory row the counterparty fields
  // may have been picked from.
  if (d.counterpartyId) {
    const known = await prisma.counterparty.findUnique({
      where: { id: d.counterpartyId },
      select: { id: true },
    });
    if (!known) return fail(422, "contract.counterpartyNotFound");
  }

  // Is the gear actually free? Checked here rather than only in the form,
  // because the form's answer is a moment old by the time it is submitted and
  // two people drawing contracts at once is exactly the case this exists for.
  //
  // Not a lock, deliberately. Two simultaneous requests for the last Soundboks
  // can both pass this and both write, and the cure for that is a transaction
  // holding a lock on every catalogue row involved, for a section that rents
  // things out a few times a term. What this prevents is the ordinary mistake,
  // somebody drawing a second contract for a weekend that is already spoken
  // for, which is the one that actually happens.
  const clashes = await checkAvailability({
    lines: d.lines,
    period: { from: d.pickupAt, to: d.returnAt },
    exclude,
  });
  if (clashes.length > 0) {
    const named = await nameShortfalls(clashes);
    return fail(409, "contract.itemsUnavailable", {
      values: { items: named.map((n) => `${n.name} (${n.owned - n.booked}/${n.wanted})`).join(", ") },
    });
  }

  return null;
}

/** Who the renter is, and the period the archive files the agreement under. */
export const agreementColumns = (d: CreateRental) => ({
  counterparty: d.counterparty,
  counterpartyOrgNo: d.counterpartyOrgNo,
  counterpartyAddress: d.counterpartyAddress,
  counterpartyPostalCode: d.counterpartyPostalCode,
  counterpartyCity: d.counterpartyCity,
  counterpartyEmail: d.counterpartyEmail ?? null,
  counterpartyPhone: d.counterpartyPhone ?? null,
  counterpartyId: d.counterpartyId ?? null,
  // Copied from the rental period, so that one expiry query serves every
  // document in the archive and the list does not have to know which of them
  // keep their dates somewhere else.
  validFrom: isoToDate(d.pickupAt),
  validTo: isoToDate(d.returnAt),
});

/**
 * The rental's own columns. The rent is worked out here rather than taken from
 * the request: the form ran the same function over the same lines to show the
 * figure, so the two agree by construction rather than by both being careful.
 */
export function rentalColumns(d: CreateRental) {
  const pricing = rentalPricing(d.lines);
  return {
    pickupAt: isoToDate(d.pickupAt)!,
    returnAt: isoToDate(d.returnAt)!,
    purpose: d.purpose,
    signatureCount: d.signatureCount,
    subtotalOre: pricing.subtotalOre,
    discountOre: pricing.discountOre,
    priceOre: pricing.totalOre,
  };
}

/**
 * The lines, in the order they were typed. Not appended through
 * lib/server/sort-order.ts: they are written together in one statement, so
 * there is no second writer to race with.
 */
export const rentalLines = (d: CreateRental) =>
  d.lines.map((l, i) => ({
    itemId: l.itemId ?? null,
    description: l.description,
    quantity: l.quantity,
    unitPriceOre: l.unitPriceOre,
    discountPercent: l.discountPercent,
    replacementValueOre: l.replacementValueOre,
    sortOrder: i,
  }));
