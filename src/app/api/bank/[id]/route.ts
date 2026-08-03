import { prisma } from "@/lib/server/db";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";

// DELETE /api/bank/:id — bookkeeper/admin only. Refuses if the transaction is
// matched to an expense (caller must unmatch first).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const txn = await prisma.bankTransaction.findUnique({
    where: { id },
    include: { matchedExpense: { select: { reference: true } } },
  });
  if (!txn) return fail(404, "notFound");

  if (txn.matchedExpense) {
    return fail(409, "bank.txnMatched", {
      values: { reference: txn.matchedExpense.reference },
    });
  }

  await prisma.bankTransaction.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
