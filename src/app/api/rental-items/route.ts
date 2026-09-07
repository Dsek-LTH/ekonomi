// Add gear to the catalogue.
//
// Gated on CONTRACT_MANAGE rather than SETTINGS, even though the screen lives
// under Inställningar. The catalogue is not configuration of the app, it is a
// list of the section's things, and the people who write uthyrningsavtal are
// the people who know what a speaker costs to replace.
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

  // Names are unique, so that a rental contract cannot list "Högtalare" twice
  // at two replacement values. Checked here for the message; the column's
  // constraint is what actually holds it.
  const existing = await prisma.rentalItem.findUnique({
    where: { name: d.name },
    select: { id: true },
  });
  if (existing) return fail(409, "contract.itemExists", { values: { name: d.name } });

  const item = await prisma.rentalItem.create({
    data: {
      name: d.name,
      description: d.description ?? null,
      dailyPriceOre: d.dailyPriceOre ?? null,
      replacementValueOre: d.replacementValueOre,
    },
    select: { id: true },
  });

  return NextResponse.json(item, { status: 201 });
}
