import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchLineItem } from "@/lib/api/schemas/budget";
import { denyBudgetWrite } from "@/lib/budget/access";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ lineItem: id });
  if (denied) return denied;

  const parsed = await parseBody(req, PatchLineItem);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const data: Record<string, unknown> = {};
  if (body.description !== undefined) data.description = body.description;
  if (body.expression !== undefined) data.expression = body.expression;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
  // quantity / unitPrice: a value sets the "antal × á-pris" form; an empty
  // string arrives as null and clears it (back to the standalone expression).
  if (body.quantity !== undefined) data.quantity = body.quantity;
  if (body.unitPrice !== undefined) data.unitPrice = body.unitPrice;

  // columnValues: { [columnId]: string } — merged into the line's `values` JSON
  // (empty string clears that column's cell).
  if (body.columnValues) {
    const cur = await prisma.budgetLineItem.findUnique({ where: { id }, select: { values: true } });
    const merged: Record<string, string> = { ...((cur?.values as Record<string, string>) ?? {}) };
    for (const [k, v] of Object.entries(body.columnValues)) {
      if (v.trim() === "") delete merged[k];
      else merged[k] = v.trim();
    }
    data.values = merged;
  }

  // `denyBudgetWrite` walked this id up to its budget, so it existed a moment
  // ago; this covers it being gone by now.
  const item = await orNotFound(() => prisma.budgetLineItem.update({ where: { id }, data }));
  if (item instanceof NextResponse) return item;
  return NextResponse.json(item);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ lineItem: id });
  if (denied) return denied;
  const deleted = await orNotFound(() => prisma.budgetLineItem.delete({ where: { id } }));
  if (deleted instanceof NextResponse) return deleted;
  return new Response(null, { status: 204 });
}
