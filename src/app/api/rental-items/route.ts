// Add gear to the catalogue.
//
// Gated on CONTRACT_MANAGE, not SETTINGS: the catalogue is the section's things, not app configuration.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateRentalItem } from "@/lib/api/schemas/contract";

// POST /api/rental-items
export async function POST(req: Request) {
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateRentalItem);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // Names are unique so a contract cannot list "Högtalare" twice at two values. Checked here for the message.
  const existing = await prisma.rentalItem.findUnique({
    where: { name: d.name },
    select: { id: true },
  });
  if (existing) return fail(409, "contract.itemExists", { values: { name: d.name } });

  const item = await prisma.rentalItem.create({
    data: {
      name: d.name,
      description: d.description ?? null,
      quantity: d.quantity,
      dailyPriceOre: d.dailyPriceOre ?? null,
      replacementValueOre: d.replacementValueOre,
    },
    select: { id: true },
  });

  return NextResponse.json(item, { status: 201 });
}
