// Set the resultatansvariga for a result unit (admin only).
// Body: { userIds: string[] } — replaces the result unit's ownerships with the
// given set. Users must hold the RESULTATANSVARIG role for the ownership to
// grant attest authority (see lib/domain/permissions.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { SetOwners } from "@/lib/api/schemas/admin";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: resultUnitId } = await ctx.params;
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  if (!(await prisma.resultUnit.findUnique({ where: { id: resultUnitId } }))) {
    return fail(404, "resultUnit.notFound");
  }

  const parsed = await parseBody(req, SetOwners);
  if (!parsed.ok) return parsed.res;
  const userIds = [...new Set(parsed.data.userIds)];

  if (userIds.length) {
    const found = await prisma.user.count({ where: { id: { in: userIds } } });
    if (found !== userIds.length) return fail(422, "user.unknown");
  }

  await prisma.$transaction([
    prisma.resultUnitOwner.deleteMany({ where: { resultUnitId } }),
    ...userIds.map((userId) =>
      prisma.resultUnitOwner.create({ data: { resultUnitId, userId } }),
    ),
  ]);

  return NextResponse.json({ resultUnitId, userIds });
}
