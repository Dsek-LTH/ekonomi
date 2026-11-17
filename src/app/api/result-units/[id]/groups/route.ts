// Which Authentik groups answer for one result unit (its resultatansvariga). Set on the unit, where the question is
// asked (docs/settings.md). One transaction replaces the unit's rows and re-derives everyone whose stored group list
// touches them (lib/server/authentik-roles.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { isSectionGroup } from "@/lib/domain/group-name";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { reapplyGrants } from "@/lib/server/authentik-roles";
import { changeAuthority } from "@/lib/server/authority-change";
import { PutResultUnitGroups } from "@/lib/api/schemas/admin";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, PutResultUnitGroups);
  if (!parsed.ok) return parsed.res;
  const groups = [...new Set(parsed.data.groups)];

  // A group outside `dsek.` is not the section's and confers nothing: refused rather than stored and ignored.
  const outside = groups.find((group) => !isSectionGroup(group));
  if (outside) return fail(422, "authority.groupOutsideSection", { values: { group: outside } });

  if (!(await prisma.resultUnit.findUnique({ where: { id }, select: { id: true } }))) {
    return fail(404, "resultUnit.notFound");
  }

  // Through changeAuthority for its serializable transaction. A unit's attesters never hold SETTINGS through it, so
  // the lockout check cannot fail here.
  const done = await changeAuthority(async (tx) => {
    await tx.groupResultUnit.deleteMany({ where: { resultUnitId: id } });
    if (groups.length > 0) {
      await tx.groupResultUnit.createMany({
        data: groups.map((group) => ({ group, resultUnitId: id })),
      });
    }
    return reapplyGrants(tx);
  });
  if (!done.ok) return fail(409, "authority.wouldLockOut");

  return NextResponse.json({ affected: done.value });
}
