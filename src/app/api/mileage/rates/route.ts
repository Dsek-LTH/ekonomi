// Admin only: this decides what a milersättning is worth. Claims carry the rate they were valued at (mileageOrePerKm on Expense), so edits never re-value them.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { MileageRateInput } from "@/lib/api/schemas/admin";

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, MileageRateInput);
  if (!parsed.ok) return parsed.res;
  const { orePerKm, validFrom, note } = parsed.data;

  // Two rates starting the same day cannot be resolved; caught here so the answer is a sentence, not a unique-constraint 500.
  const clash = await prisma.mileageRate.findUnique({
    where: { validFrom: new Date(validFrom) },
  });
  if (clash) return fail(409, "mileage.rateExists", { values: { date: validFrom } });

  const rate = await prisma.mileageRate.create({
    data: {
      orePerKm,
      validFrom: new Date(validFrom),
      note: note ?? null,
      createdById: g.actor.id,
    },
  });
  return NextResponse.json({ id: rate.id }, { status: 201 });
}
