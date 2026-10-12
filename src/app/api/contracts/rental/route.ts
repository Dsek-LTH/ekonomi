// Draw an uthyrningsavtal.
//
// One call rather than the draft-then-fill flow the expense wizard uses. An
// utlägg has to exist before a receipt can be attached to it, which is what
// forces that shape; a rental has nothing to attach until it is complete, so
// there is no reason to leave half-finished contracts behind every time
// somebody opens the form and walks away.
//
// Everything lands in one transaction: the contract, its rental half and its
// lines. The document is drawn *after* it commits, because a
// typesetter is not something to hold a database transaction open across, and
// a contract whose PDF failed to draw is still a contract that the screen can
// redraw. The reverse, a PDF in the bucket with no row behind it, is not
// recoverable from anywhere.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateRental } from "@/lib/api/schemas/contract";
import { rentalTitle } from "@/lib/contract/signatory";
import { storeContractDocument } from "@/lib/contract/document";
import {
  agreementColumns,
  refuseRental,
  rentalColumns,
  rentalLines,
} from "@/lib/contract/rental/write";

// POST /api/contracts/rental
export async function POST(req: Request) {
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateRental);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // The period, the catalogue, the directory row and whether the gear is free.
  // The edit route asks the same questions, so they live in rental/write.ts.
  const refused = await refuseRental(d);
  if (refused) return refused;

  const contract = await prisma.contract.create({
    data: {
      // A rental is a CONTRACT row with a RentalDetails relation attached,
      // not its own kind; see prisma/schema/contract.prisma.
      kind: "CONTRACT",
      // Derived, not typed. See lib/contract/signatory.ts.
      title: rentalTitle(d.counterparty),
      createdById: g.actor.id,

      agreement: { create: agreementColumns(d) },
      rental: { create: { ...rentalColumns(d), lines: { create: rentalLines(d) } } },

      // No party rows. Who signs for the renter is rarely known when the
      // contract is drawn, so the document draws `signatureCount` blocks
      // instead, and the signed file is the record of who put their name to
      // it. Who drew this contract up is still on the row, as `createdById`.
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
