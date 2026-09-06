// Amend or remove one party on a contract.
import { prisma } from "@/lib/server/db";
import { canManageContracts } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateParty } from "@/lib/api/schemas/contract";
import { isoToDate } from "@/lib/domain/date";
import type { Prisma } from "@/lib/generated/prisma/client";

// Both ids, so a party id from one contract cannot be reached through
// another's URL.
const findParty = (contractId: string, partyId: string) =>
  prisma.contractParty.findFirst({
    where: { id: partyId, contractId },
    select: { id: true, signedAt: true, signatureMethod: true },
  });

// PATCH /api/contracts/:id/parties/:partyId
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; partyId: string }> },
) {
  const { id, partyId } = await ctx.params;
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const party = await findParty(id, partyId);
  if (!party) return fail(404, "contract.partyNotFound");

  const parsed = await parseBody(req, UpdateParty);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  if (d.userId) {
    const user = await prisma.user.findUnique({ where: { id: d.userId }, select: { id: true } });
    if (!user) return fail(422, "user.unknown");
  }

  const data: Prisma.ContractPartyUpdateInput = {};
  if (d.role !== undefined) data.role = d.role;
  if (d.name !== undefined) data.name = d.name;
  if (d.email !== undefined) data.email = d.email;
  if (d.phone !== undefined) data.phone = d.phone;
  if (d.orgName !== undefined) data.orgName = d.orgName;
  if (d.orgNo !== undefined) data.orgNo = d.orgNo;
  if (d.title !== undefined) data.title = d.title;
  if (d.userId !== undefined) {
    data.user = d.userId ? { connect: { id: d.userId } } : { disconnect: true };
  }

  // The two travel together. Clearing the date clears the method, because a
  // method without a date says a signature was made and declines to say when;
  // setting one without a method means PAPER, which is what every signature
  // recorded through this route is.
  if (d.signedAt !== undefined) {
    data.signedAt = isoToDate(d.signedAt);
    data.signatureMethod = d.signedAt
      ? (d.signatureMethod ?? party.signatureMethod ?? "PAPER")
      : null;
  } else if (d.signatureMethod !== undefined && party.signedAt) {
    data.signatureMethod = d.signatureMethod;
  }

  await prisma.contractParty.update({ where: { id: party.id }, data });
  return new Response(null, { status: 204 });
}

// DELETE /api/contracts/:id/parties/:partyId
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; partyId: string }> },
) {
  const { id, partyId } = await ctx.params;
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const party = await findParty(id, partyId);
  if (!party) return fail(404, "contract.partyNotFound");

  await prisma.contractParty.delete({ where: { id: party.id } });
  return new Response(null, { status: 204 });
}
