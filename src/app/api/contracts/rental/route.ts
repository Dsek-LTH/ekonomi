// One transaction for contract, rental half and lines; the PDF is drawn after commit (a typesetter is not held across a transaction, and a failed draw can be redrawn).
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

  // Shared with the edit route (rental/write.ts).
  const refused = await refuseRental(d);
  if (refused) return refused;

  const contract = await prisma.contract.create({
    data: {
      // A rental is a CONTRACT row with RentalDetails (prisma/schema/contract.prisma).
      kind: "CONTRACT",
      title: rentalTitle(d.counterparty),
      createdById: g.actor.id,

      agreement: { create: agreementColumns(d) },
      rental: { create: { ...rentalColumns(d), lines: { create: rentalLines(d) } } },

      // No party rows: signers are rarely known, so the document draws signatureCount blocks.
    },
    select: { id: true },
  });

  // Outside the transaction; a failure is reported, not raised: the contract exists and the screen offers "rita om dokumentet".
  const drawn = await storeContractDocument(contract.id, g.actor.id);
  if (!drawn.ok) {
    console.error(`[contracts] ${contract.id}: drawn document failed`, drawn);
    return NextResponse.json({ id: contract.id, documentDrawn: false }, { status: 201 });
  }

  return NextResponse.json({ id: contract.id, documentDrawn: true }, { status: 201 });
}
