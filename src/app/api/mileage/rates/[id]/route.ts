// Edit or remove one mileage rate. Admin only, see the POST route beside this.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { MileageRateInput } from "@/lib/api/schemas/admin";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, MileageRateInput);
  if (!parsed.ok) return parsed.res;
  const { orePerKm, validFrom, note } = parsed.data;

  const existing = await prisma.mileageRate.findUnique({ where: { id } });
  if (!existing) return fail(404, "mileage.rateNotFound");

  const clash = await prisma.mileageRate.findUnique({ where: { validFrom: new Date(validFrom) } });
  if (clash && clash.id !== id) {
    return fail(409, "mileage.rateExists", { values: { date: validFrom } });
  }

  await prisma.mileageRate.update({
    where: { id },
    data: { orePerKm, validFrom: new Date(validFrom), note: note ?? null },
  });
  return NextResponse.json({ id });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const existing = await prisma.mileageRate.findUnique({ where: { id } });
  if (!existing) return fail(404, "mileage.rateNotFound");

  // Nothing cascades and nothing is orphaned: a trip holds its own öre-per-km
  // rather than pointing at a row here, which is exactly so that a rate entered
  // by mistake can be taken back out without touching a claim.
  await prisma.mileageRate.delete({ where: { id } });
  return NextResponse.json({ id });
}
