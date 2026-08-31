// The mileage rate table: what a kilometre is worth, from a given day.
//
// Admin only, and deliberately so: this is the one figure that decides how
// much money a milersättning is worth, and it is Skatteverket's rather than
// anybody's judgement. A claim already filed is never re-valued by a change
// here: each claim carries the rate it was valued at (see `mileageOrePerKm`
// on Expense), which is what makes editing this table safe at all.
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

  // Two rates starting on the same day is not a period anybody could resolve,
  // and the column says so too, caught here so the answer is a sentence
  // rather than a unique-constraint 500.
  const clash = await prisma.mileageRate.findUnique({ where: { validFrom: new Date(validFrom) } });
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
