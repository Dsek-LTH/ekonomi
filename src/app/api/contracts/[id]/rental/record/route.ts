// What actually happened, as against what was agreed.
//
// Its own route rather than a field on the rental patch, because this is the
// one part of a rental that stays editable after the contract is signed. The
// terms are frozen once the document goes out; when the gear left, what state
// it was in, when it came back and when somebody accepted it back are events,
// and a record of events has to be writable when the events occur.
//
// The distinction between `returnedAt` and `checkedAt` is the point of the
// whole route. Handing a Soundboks back is not the same as somebody plugging it
// in and finding it works, and the villkor say the rental is not over until the
// second one has happened. See lib/contract/rental/terms.ts.
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

  // Accepting the gear back is the one thing here that is somebody's decision
  // rather than an observation, so it records who made it. Clearing the date
  // clears the name with it: a checker on a rental nobody has checked would be
  // a signature under a blank line.
  if (d.checkedAt !== undefined) {
    data.checkedAt = isoToDate(d.checkedAt);
    data.checkedBy = d.checkedAt ? { connect: { id: g.actor.id } } : { disconnect: true };
  }

  // Nothing is redrawn. The document says what was agreed, and when the gear
  // came back is not one of its terms: stamping a return date onto a signed
  // contract would be amending it after the fact.
  await prisma.rentalDetails.update({ where: { contractId: rental.contractId }, data });
  return new Response(null, { status: 204 });
}
