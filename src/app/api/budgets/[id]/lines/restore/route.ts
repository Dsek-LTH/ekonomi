import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { parseBody } from "@/lib/api/parse";
import { RestoreLines } from "@/lib/api/schemas/budget";
import { allowBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";
import { lockForAppend } from "@/lib/server/sort-order";

// POST /api/budgets/[id]/lines/restore: lines made again where they stood, in one write (⌘Z on
// a delete of several, ⌘⇧Z on a paste that made lines). Each account is then put in the order
// given, its new lines in place of their old ids; a line there that the order does not name (one
// added since) keeps its place after them. Answers with each old id's new one and the orders.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: budgetId } = await ctx.params;
  const g = await allowBudgetWrite({ budget: budgetId });
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, RestoreLines);
  if (!parsed.ok) return parsed.res;
  const { lines, orders } = parsed.data;

  const accountIds = [
    ...new Set([...lines.map((l) => l.accountId), ...orders.map((o) => o.accountId)]),
  ];
  const found = await prisma.budgetAccount.count({
    where: { id: { in: accountIds }, budgetCostCenter: { budgetId } },
  });
  if (found !== accountIds.length) return fail(404, "notFound");

  const result = await prisma.$transaction(async (tx) => {
    for (const accountId of accountIds) await lockForAppend(tx, "budgetAccount", accountId);

    const made: Record<string, string> = {};
    const created = [];
    for (const l of lines) {
      const row = await tx.budgetLineItem.create({
        data: {
          accountId: l.accountId,
          description: l.description,
          expression: l.expression || "0",
          sortOrder: 0,
        },
      });
      made[l.key] = row.id;
      created.push({ ...row, accountId: l.accountId });
    }

    const finalOrders: { accountId: string; ids: string[] }[] = [];
    for (const accountId of accountIds) {
      const now = await tx.budgetLineItem.findMany({
        where: { accountId },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      });
      const there = new Set(now.map((l) => l.id));
      const asked = orders.find((o) => o.accountId === accountId)?.ids ?? [];
      const named = asked.map((id) => made[id] ?? id).filter((id) => there.has(id));
      const rest = now.map((l) => l.id).filter((id) => !named.includes(id));
      const ids = [...named, ...rest];
      for (const [i, id] of ids.entries()) {
        await tx.budgetLineItem.update({ where: { id }, data: { sortOrder: i } });
      }
      finalOrders.push({ accountId, ids });
    }
    return { made, created, orders: finalOrders };
  });
  return NextResponse.json(result);
}
