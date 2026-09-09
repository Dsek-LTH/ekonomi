// Amend or retire one counterparty directory entry.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateCounterparty } from "@/lib/api/schemas/contract";
import type { Prisma } from "@/lib/generated/prisma/client";

// PATCH /api/counterparties/:id
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateCounterparty);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const data: Prisma.CounterpartyUpdateInput = {};
  if (d.name !== undefined) data.name = d.name;
  if (d.orgNo !== undefined) data.orgNo = d.orgNo;
  if (d.address !== undefined) data.address = d.address;
  if (d.postalCode !== undefined) data.postalCode = d.postalCode;
  if (d.city !== undefined) data.city = d.city;
  if (d.notes !== undefined) data.notes = d.notes;
  if (d.active !== undefined) data.active = d.active;

  // Nothing here reaches a contract that already points at this row: the
  // fields it printed were copied at the moment it was filed. See
  // Contract.counterpartyId in the schema.
  const updated = await orNotFound(
    () => prisma.counterparty.update({ where: { id }, data, select: { id: true } }),
    "contract.counterpartyNotFound",
  );
  if (updated instanceof NextResponse) return updated;

  return new Response(null, { status: 204 });
}

// DELETE /api/counterparties/:id
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const counterparty = await prisma.counterparty.findUnique({
    where: { id },
    select: { id: true, active: true, _count: { select: { agreements: true } } },
  });
  if (!counterparty) return fail(404, "contract.counterpartyNotFound");

  // Retired rather than deleted where a contract still points at it, the same
  // rule rental-items/[id]/route.ts follows for the gear catalogue.
  if (counterparty._count.agreements > 0) {
    if (counterparty.active) {
      await prisma.counterparty.update({ where: { id: counterparty.id }, data: { active: false } });
    }
    return NextResponse.json({ retired: true, usedBy: counterparty._count.agreements });
  }

  await prisma.counterparty.delete({ where: { id: counterparty.id } });
  return new Response(null, { status: 204 });
}
