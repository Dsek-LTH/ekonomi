// Amend or delete one counterparty directory entry.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateCounterparty } from "@/lib/api/schemas/contract";
import type { Prisma } from "@/lib/generated/prisma/client";

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
  if (d.email !== undefined) data.email = d.email;
  if (d.phone !== undefined) data.phone = d.phone;
  if (d.notes !== undefined) data.notes = d.notes;

  // Contracts already pointing at this row keep the fields copied when filed (Contract.counterpartyId).
  const updated = await orNotFound(
    () => prisma.counterparty.update({ where: { id }, data, select: { id: true } }),
    "contract.counterpartyNotFound",
  );
  if (updated instanceof NextResponse) return updated;

  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const counterparty = await prisma.counterparty.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!counterparty) return fail(404, "contract.counterpartyNotFound");

  // Deleted even when a contract names it: agreements copy the details when filed and the relation is SetNull.
  await prisma.counterparty.delete({ where: { id: counterparty.id } });
  return new Response(null, { status: 204 });
}
