// Order of an utlägg's documents (panel paging, merged PDF). Same gate as adding one (../route.ts).
import { prisma } from "@/lib/server/db";
import { isEditable, isRecallable } from "@/lib/domain/status";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { ReorderReceipts } from "@/lib/api/schemas/expense";
import { canEditExpense, denyExpenseView } from "@/lib/api/expense-access";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: expenseId } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { receipts: { select: { id: true } } },
  });
  if (!expense) return fail(404, "expense.notFound");
  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return hidden;
  if (!canEditExpense(g.actor, expense)) return fail(403, "expense.noReceiptAccess");
  if (!isEditable(expense.status)) {
    return isRecallable(expense.status)
      ? fail(409, "expense.editWhilePendingAttest")
      : fail(409, "expense.notChangeableInStatus", {
          values: { status: { key: `common.status.${expense.status}` } },
        });
  }

  const parsed = await parseBody(req, ReorderReceipts);
  if (!parsed.ok) return parsed.res;
  const { ids } = parsed.data;

  const have = new Set(expense.receipts.map((r) => r.id));
  if (
    ids.length !== have.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !have.has(id))
  ) {
    return fail(422, "receipt.orderMismatch");
  }

  await prisma.$transaction(
    ids.map((id, position) => prisma.receipt.update({ where: { id }, data: { position } })),
  );
  return new Response(null, { status: 204 });
}
