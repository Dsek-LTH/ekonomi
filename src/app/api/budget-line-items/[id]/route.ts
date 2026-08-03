import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { denyBudgetWrite } from "@/lib/budget/access";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ lineItem: id });
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.description === "string" && body.description.trim()) data.description = body.description.trim();
  if (typeof body.expression === "string") data.expression = body.expression.trim();
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
  // quantity / unitPrice: a non-empty string sets the "antal × á-pris" form;
  // an empty string clears it (back to the standalone expression).
  if ("quantity" in body) data.quantity = typeof body.quantity === "string" && body.quantity.trim() ? body.quantity.trim() : null;
  if ("unitPrice" in body) data.unitPrice = typeof body.unitPrice === "string" && body.unitPrice.trim() ? body.unitPrice.trim() : null;

  // columnValues: { [columnId]: string } — merged into the line's `values` JSON
  // (empty string clears that column's cell).
  if (body.columnValues && typeof body.columnValues === "object") {
    const cur = await prisma.budgetLineItem.findUnique({ where: { id }, select: { values: true } });
    const merged: Record<string, string> = { ...((cur?.values as Record<string, string>) ?? {}) };
    for (const [k, v] of Object.entries(body.columnValues as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      if (v.trim() === "") delete merged[k];
      else merged[k] = v.trim();
    }
    data.values = merged;
  }

  const item = await prisma.budgetLineItem.update({ where: { id }, data });
  return NextResponse.json(item);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ lineItem: id });
  if (denied) return denied;
  await prisma.budgetLineItem.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
