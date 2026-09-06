// The gear came back, and the deposit went back.
//
// Its own route rather than a field on the rental patch, because it is the one
// thing about a rental that stays editable after the contract is signed. What
// was agreed is frozen; what actually happened is a record, and a record of
// events has to be writable when the events occur.
import { prisma } from "@/lib/server/db";
import { canManageContracts } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { SettleRental } from "@/lib/api/schemas/contract";
import { isoToDate } from "@/lib/domain/date";
import type { Prisma } from "@/lib/generated/prisma/client";

// PATCH /api/contracts/:id/rental/return
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const rental = await prisma.rentalDetails.findUnique({
    where: { contractId: id },
    select: { contractId: true },
  });
  if (!rental) return fail(422, "contract.rentalNotFound");

  const parsed = await parseBody(req, SettleRental);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // Both clearable, because "has it come back yet" is a question somebody can
  // answer wrongly and then correct. Absent means "leave it".
  const data: Prisma.RentalDetailsUpdateInput = {};
  if (d.returnedAt !== undefined) data.returnedAt = isoToDate(d.returnedAt);
  if (d.depositReturnedAt !== undefined) {
    data.depositReturnedAt = isoToDate(d.depositReturnedAt);
  }

  // Nothing is redrawn here. The document says what was agreed, and when the
  // gear came back is not one of its terms: stamping a return date onto a
  // signed contract would be amending it after the fact.
  await prisma.rentalDetails.update({ where: { contractId: rental.contractId }, data });
  return new Response(null, { status: 204 });
}
