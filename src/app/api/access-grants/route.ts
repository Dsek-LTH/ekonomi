// Give one member a role or a capability of their own, for a period or until removed (AccessGrant). The giver may
// be the member themselves: holding GRANT_ACCESS is trusted with that.
import { NextResponse } from "next/server";
import { canGrantAccess } from "@/lib/domain/permissions";
import { grantPeriod } from "@/lib/domain/access-grant";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateAccessGrant } from "@/lib/api/schemas/admin";
import { pruneEndedGrants } from "@/lib/server/access";
import { prisma } from "@/lib/server/db";

export async function POST(req: Request) {
  const g = await gate(canGrantAccess, "auth.grantAccessOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateAccessGrant);
  if (!parsed.ok) return parsed.res;
  const { userId, role, capability, from, until } = parsed.data;

  const period = grantPeriod(from, until, new Date());
  if (!period.ok) return fail(422, period.error);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { active: true } });
  if (!user) return fail(404, "notFound");
  if (!user.active) return fail(409, "grant.inactiveUser");

  const grant = await prisma.accessGrant.create({
    data: {
      userId,
      role,
      capability,
      validFrom: period.validFrom,
      validUntil: period.validUntil,
      grantedById: g.actor.id,
    },
    select: { id: true },
  });
  await pruneEndedGrants();

  return NextResponse.json(grant, { status: 201 });
}
