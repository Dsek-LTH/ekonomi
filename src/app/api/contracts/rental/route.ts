// Draw an uthyrningsavtal.
//
// One call rather than the draft-then-fill flow the expense wizard uses. An
// utlägg has to exist before a receipt can be attached to it, which is what
// forces that shape; a rental has nothing to attach until it is complete, so
// there is no reason to leave half-finished contracts behind every time
// somebody opens the form and walks away.
//
// Everything lands in one transaction: the contract, its rental half, its
// lines and the two parties. The document is drawn *after* it commits, because
// a typesetter is not something to hold a database transaction open across, and
// a contract whose PDF failed to draw is still a contract that the screen can
// redraw. The reverse, a PDF in the bucket with no row behind it, is not
// recoverable from anywhere.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateRental } from "@/lib/api/schemas/contract";
import { rentalTitle } from "@/lib/contract/signatory";
import { storeContractDocument } from "@/lib/contract/document";
import { checkAvailability, nameShortfalls } from "@/lib/data/rental-availability";
import { rentalPricing } from "@/lib/contract/rental/pricing";
import { isoToDate } from "@/lib/domain/date";

// POST /api/contracts/rental
export async function POST(req: Request) {
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateRental);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

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
  const clashes = await checkAvailability({ lines: d.lines, period: { from: d.pickupAt, to: d.returnAt } });
  if (clashes.length > 0) {
    const named = await nameShortfalls(clashes);
    return fail(409, "contract.itemsUnavailable", {
      values: { items: named.map((n) => `${n.name} (${n.owned - n.booked}/${n.wanted})`).join(", ") },
    });
  }

  // The rent, worked out here rather than taken from the request. The form ran
  // the same function over the same lines to show the figure, so the two agree
  // by construction rather than by both being careful.
  const pricing = rentalPricing(d.lines);

  const contract = await prisma.contract.create({
    data: {
      // A rental is a CONTRACT row with a RentalDetails relation attached,
      // not its own kind; see prisma/schema/contract.prisma.
      kind: "CONTRACT",
      // Derived, not typed. See lib/contract/signatory.ts.
      title: rentalTitle(d.counterparty),
      createdById: g.actor.id,

      agreement: {
        create: {
          status: "DRAFT",
          counterparty: d.counterparty,
          counterpartyOrgNo: d.counterpartyOrgNo,
          counterpartyAddress: d.counterpartyAddress,
          counterpartyPostalCode: d.counterpartyPostalCode,
          counterpartyCity: d.counterpartyCity,
          counterpartyId: d.counterpartyId ?? null,

          // Copied from the rental period, so that one expiry query serves
          // every document in the archive and the list does not have to
          // know which of them keep their dates somewhere else.
          validFrom: isoToDate(d.pickupAt),
          validTo: isoToDate(d.returnAt),
        },
      },

      rental: {
        create: {
          pickupAt: isoToDate(d.pickupAt)!,
          returnAt: isoToDate(d.returnAt)!,
          purpose: d.purpose,
          place: d.place ?? null,
          paymentDueAt: isoToDate(d.paymentDueAt ?? null),
          subtotalOre: pricing.subtotalOre,
          discountOre: pricing.discountOre,
          priceOre: pricing.totalOre,
          lines: {
            create: d.lines.map((l, i) => ({
              itemId: l.itemId ?? null,
              description: l.description,
              quantity: l.quantity,
              unitPriceOre: l.unitPriceOre,
              discountPercent: l.discountPercent,
              replacementValueOre: l.replacementValueOre,
              // The order they were typed in. Not appended through
              // lib/server/sort-order.ts: these are created together in one
              // statement, so there is no second writer to race with.
              sortOrder: i,
            })),
          },
        },
      },

      // Only the renter's side. The section does not sign its own rentals: an
      // accept from the renter is what avtalslagen asks for and what the
      // liability clause turns on, and the section's side of the deal is
      // already evidenced by the document it issued (see rental-contract.typ,
      // Underskrifter). Who drew this contract up is still on the row, as
      // `createdById` above.
      parties: {
        create: [
          {
            role: "COUNTERPARTY" as const,
            name: d.counterpartySignatory.name,
            email: d.counterpartySignatory.email ?? null,
            phone: d.counterpartySignatory.phone ?? null,
            title: d.counterpartySignatory.title ?? null,
            orgName: d.counterparty,
          },
        ],
      },
    },
    select: { id: true },
  });

  // Outside the transaction, and a failure here is reported rather than raised:
  // the contract exists, the screen it lands on offers "rita om dokumentet",
  // and telling somebody their contract was not created when it was is the
  // worse of the two wrong answers.
  const drawn = await storeContractDocument(contract.id, g.actor.id);
  if (!drawn.ok) {
    console.error(`[contracts] ${contract.id}: drawn document failed`, drawn);
    return NextResponse.json({ id: contract.id, documentDrawn: false }, { status: 201 });
  }

  return NextResponse.json({ id: contract.id, documentDrawn: true }, { status: 201 });
}
