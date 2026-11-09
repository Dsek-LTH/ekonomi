// Events (gear out, state, returned, checked) stay editable after signing; the terms do not.
// returnedAt is not checkedAt: the rental is not over until the second (lib/contract/rental/terms.ts).
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { RecordRental } from "@/lib/api/schemas/contract";
import { isoToDate } from "@/lib/domain/date";
import type { Prisma } from "@/lib/generated/prisma/client";

// PATCH /api/contracts/:id/rental/record
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const rental = await prisma.rentalDetails.findUnique({
    where: { contractId: id },
    select: { contractId: true, checkedAt: true },
  });
  if (!rental) return fail(422, "contract.rentalNotFound");

  const parsed = await parseBody(req, RecordRental);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const data: Prisma.RentalDetailsUpdateInput = {};
  if (d.returnedAt !== undefined) data.returnedAt = isoToDate(d.returnedAt);
  if (d.conditionOut !== undefined) data.conditionOut = d.conditionOut;
  if (d.conditionIn !== undefined) data.conditionIn = d.conditionIn;

  // Accepting the gear back is a decision, so it records who; clearing the date clears the name.
  if (d.checkedAt !== undefined) {
    data.checkedAt = isoToDate(d.checkedAt);
    data.checkedBy = d.checkedAt ? { connect: { id: g.actor.id } } : { disconnect: true };
  }

  // Nothing is redrawn: stamping a return date onto a signed contract would amend it.
  await prisma.rentalDetails.update({ where: { contractId: rental.contractId }, data });
  return new Response(null, { status: 204 });
}
