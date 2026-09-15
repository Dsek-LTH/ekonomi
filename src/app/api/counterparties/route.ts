// Add an organisation or person to the counterparty directory.
//
// Gated on canManageRentals rather than a narrower check, because that
// already means "has RENTAL_MANAGE or CONTRACT_MANAGE", which is exactly the
// union of people who use either contract-creation form. Same reasoning
// rental-items/route.ts uses for the gear catalogue.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateCounterparty } from "@/lib/api/schemas/contract";

// POST /api/counterparties
export async function POST(req: Request) {
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateCounterparty);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const counterparty = await prisma.counterparty.create({
    data: {
      name: d.name,
      orgNo: d.orgNo ?? null,
      address: d.address ?? null,
      postalCode: d.postalCode ?? null,
      city: d.city ?? null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      notes: d.notes ?? null,
      createdById: g.actor.id,
    },
    select: {
      id: true,
      name: true,
      orgNo: true,
      address: true,
      postalCode: true,
      city: true,
      email: true,
      phone: true,
    },
  });

  return NextResponse.json(counterparty, { status: 201 });
}
