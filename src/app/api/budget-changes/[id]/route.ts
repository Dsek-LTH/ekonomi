// Revoking a redaktionell ändring. DELETE, because "ta bort ändringen" is what
// it is from where the skattmästare stands, but nothing is deleted: the change
// stops counting towards the figures and stays in the history, struck through,
// with who revoked it and when. See BudgetChange in schema.prisma for why.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gateEditorialChange } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await gateEditorialChange({ change: id });
  if (!gate.ok) return gate.res;

  const change = await prisma.budgetChange.findUnique({
    where: { id },
    select: { revokedAt: true },
  });
  if (!change) return fail(404, "budget.changeNotFound");
  if (change.revokedAt) {
    return fail(409, "budget.changeRevoked");
  }

  // Set together, so "revoked" is never half-true, as with the lock itself.
  const updated = await prisma.budgetChange.update({
    where: { id },
    data: { revokedAt: new Date(), revokedById: gate.actorId },
  });
  return NextResponse.json(updated);
}
