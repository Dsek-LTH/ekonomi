// Revoking a redaktionell ändring: nothing is deleted. It stops counting and stays in the history, struck through.
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
