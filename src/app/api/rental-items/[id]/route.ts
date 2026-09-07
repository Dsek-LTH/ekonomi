// Amend or retire one catalogue item.
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
  if (d.dailyPriceOre !== undefined) data.dailyPriceOre = d.dailyPriceOre;
  if (d.replacementValueOre !== undefined) data.replacementValueOre = d.replacementValueOre;
  if (d.active !== undefined) data.active = d.active;

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
    select: { id: true, active: true, _count: { select: { lines: true } } },
  });
  if (!item) return fail(404, "contract.itemNotFound");

  // Retired rather than deleted where a contract still points at it, the same
  // answer a cost centre in use gives. The line would survive either way (the
  // relation is SetNull, and the line carries its own description and values),
  // but the trail from a contract back to the catalogue row it was drawn from
  // is worth keeping, and an item nobody can pick is what "gone" needs to mean
  // here.
  if (item._count.lines > 0) {
    if (item.active) {
      await prisma.rentalItem.update({ where: { id: item.id }, data: { active: false } });
    }
    return NextResponse.json({ retired: true, usedBy: item._count.lines });
  }

  await prisma.rentalItem.delete({ where: { id: item.id } });
  return new Response(null, { status: 204 });
}
