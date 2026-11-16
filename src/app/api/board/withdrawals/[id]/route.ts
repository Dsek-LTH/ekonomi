// Taking a withdrawal back. The member may the day they logged it. After that it is the treasurer's, and once it
// is on an invoice it is nobody's: a mistake found then is put right on the invoice in Fortnox.

import { fail, gate } from "@/lib/api/guard";
import { stockholmDay } from "@/lib/domain/date";
import { canBookkeep } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";
import { removeIssueEntry } from "@/lib/server/stock-issue";
import { bulkTransaction } from "@/lib/server/tx";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;

  const w = await prisma.boardWithdrawal.findUnique({
    where: { id },
    select: {
      memberId: true,
      invoiceLineId: true,
      createdAt: true,
      entry: { select: { id: true, productId: true, units: true } },
    },
  });
  const treasurer = canBookkeep(g.actor.capabilities);
  // Somebody else's withdrawal reads as missing to anybody but the treasurer.
  if (!w || (!treasurer && w.memberId !== g.actor.id)) return fail(404, "board.withdrawalNotFound");
  if (w.invoiceLineId) return fail(409, "board.alreadyInvoiced");

  const sameDay = stockholmDay.format(w.createdAt) === stockholmDay.format(new Date());
  if (!treasurer && !sameDay) return fail(403, "board.tooLate");

  await bulkTransaction((tx) =>
    // The withdrawal goes with its entry (onDelete: Cascade), and the removal is on the stock's change trail.
    removeIssueEntry(tx, { ...w.entry, kind: "WITHDRAWAL" }, g.actor.id),
  );
  return new Response(null, { status: 204 });
}
