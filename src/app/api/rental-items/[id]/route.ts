// Amend or delete one catalogue item.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateRentalItem } from "@/lib/api/schemas/contract";
import type { Prisma } from "@/lib/generated/prisma/client";

// PATCH /api/rental-items/:id
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateRentalItem);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  if (d.name !== undefined) {
    const clash = await prisma.rentalItem.findFirst({
      where: { name: d.name, id: { not: id } },
      select: { id: true },
    });
    if (clash) return fail(409, "contract.itemExists", { values: { name: d.name } });
  }

  const data: Prisma.RentalItemUpdateInput = {};
  if (d.name !== undefined) data.name = d.name;
  if (d.description !== undefined) data.description = d.description;
  if (d.quantity !== undefined) data.quantity = d.quantity;
  if (d.dailyPriceOre !== undefined) data.dailyPriceOre = d.dailyPriceOre;
  if (d.replacementValueOre !== undefined) data.replacementValueOre = d.replacementValueOre;

  // Nothing here reaches a contract that already quotes this item. A rental
  // line copies the description and the values at the moment it is drawn (see
  // the RentalLine model), so re-pricing a speaker today cannot re-price last
  // spring's agreement.
  const updated = await orNotFound(
    () => prisma.rentalItem.update({ where: { id }, data, select: { id: true } }),
    "contract.itemNotFound",
  );
  if (updated instanceof NextResponse) return updated;

  return new Response(null, { status: 204 });
}

// DELETE /api/rental-items/:id
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const item = await prisma.rentalItem.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!item) return fail(404, "contract.itemNotFound");

  // Deleted even when a contract quoted it. A rental line copies the
  // description and the values at the moment it is drawn, so the contract still
  // says what it said, and the relation is SetNull, so all the line loses is
  // the link back to this row.
  await prisma.rentalItem.delete({ where: { id: item.id } });
  return new Response(null, { status: 204 });
}
