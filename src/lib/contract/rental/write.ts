// Shared by the create and edit routes (same body): the same refusals and the same columns.
import "server-only";

import { prisma } from "@/lib/server/db";
import { fail } from "@/lib/api/guard";
import { checkAvailability, nameShortfalls } from "@/lib/data/rental-availability";
import { isoToDate } from "@/lib/domain/date";
import { rentalPricing } from "./pricing";
import type { CreateRental } from "@/lib/api/schemas/contract";

/** What the schema cannot see about a rental, as the refusing response, or null. `exclude` is the contract being amended. */
export async function refuseRental(d: CreateRental, exclude?: string): Promise<Response | null> {
  // A period ending before it starts. ISO days sort lexically.
  if (d.returnAt < d.pickupAt) return fail(422, "contract.returnBeforePickup");

  // Checked before writing: an unknown id would be silently dropped by SetNull.
  const itemIds = [...new Set(d.lines.map((l) => l.itemId).filter((v): v is string => Boolean(v)))];
  if (itemIds.length > 0) {
    const known = await prisma.rentalItem.count({ where: { id: { in: itemIds } } });
    if (known !== itemIds.length) return fail(422, "contract.itemNotFound");
  }

  // The same for the directory row the counterparty may have been picked from.
  if (d.counterpartyId) {
    const known = await prisma.counterparty.findUnique({
      where: { id: d.counterpartyId },
      select: { id: true },
    });
    if (!known) return fail(422, "contract.counterpartyNotFound");
  }

  // Is the gear free? Checked here because the form's answer is stale by submit. Not a
  // lock: two simultaneous requests for the last item can both pass. This prevents the
  // ordinary mistake of a second contract for a taken weekend.
  const clashes = await checkAvailability({
    lines: d.lines,
    period: { from: d.pickupAt, to: d.returnAt },
    exclude,
  });
  if (clashes.length > 0) {
    const named = await nameShortfalls(clashes);
    return fail(409, "contract.itemsUnavailable", {
      values: {
        items: named.map((n) => `${n.name} (${n.owned - n.booked}/${n.wanted})`).join(", "),
      },
    });
  }

  return null;
}

export const agreementColumns = (d: CreateRental) => ({
  counterparty: d.counterparty,
  counterpartyOrgNo: d.counterpartyOrgNo,
  counterpartyAddress: d.counterpartyAddress,
  counterpartyPostalCode: d.counterpartyPostalCode,
  counterpartyCity: d.counterpartyCity,
  counterpartyEmail: d.counterpartyEmail ?? null,
  counterpartyPhone: d.counterpartyPhone ?? null,
  counterpartyId: d.counterpartyId ?? null,
  // Copied from the rental period so one expiry query serves every document.
  validFrom: isoToDate(d.pickupAt),
  validTo: isoToDate(d.returnAt),
});

/** The rental's columns. The rent is recomputed here with the same function the form used. */
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

/** The lines in typed order. Written in one statement, so no sort-order helper is needed. */
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
