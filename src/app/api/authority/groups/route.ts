// One Authentik group's whole grant per request: roles it gives and result units it makes someone answer for
// (admin only). One transaction replaces its rows, re-derives everyone whose stored group list touches it
// (lib/server/authentik-roles.ts), and checks that somebody can still open Inställningar, rolling back otherwise.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { reapplyGrants } from "@/lib/server/authentik-roles";
import { isSectionGroup } from "@/lib/domain/group-name";
import { changeAuthority } from "@/lib/server/authority-change";
import { DeleteGroupGrant, PutGroupGrant } from "@/lib/api/schemas/admin";

const admin = () => gate(canAccessSettings, "auth.adminOnly");

export async function PUT(req: Request) {
  const g = await admin();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PutGroupGrant);
  if (!parsed.ok) return parsed.res;
  const { group, roles, resultUnitIds } = parsed.data;

  // A group outside `dsek.` is not the section's and confers nothing: refused here rather than stored and ignored at sign-in.
  if (!isSectionGroup(group))
    return fail(422, "authority.groupOutsideSection", { values: { group } });

  // A nonexistent result unit cannot be answered for. The foreign key would refuse too; this beats a 500.
  if (resultUnitIds.length > 0) {
    const found = await prisma.resultUnit.count({ where: { id: { in: resultUnitIds } } });
    if (found !== new Set(resultUnitIds).size) return fail(404, "resultUnit.notFound");
  }

  // Rolled back if it would leave nobody able to reach Inställningar. See changeAuthority: serializable catches a
  // concurrent write to a different group's rows.
  const done = await changeAuthority(async (tx) => {
    await tx.groupRole.deleteMany({ where: { group } });
    await tx.groupResultUnit.deleteMany({ where: { group } });

    if (roles.length > 0) {
      await tx.groupRole.createMany({ data: roles.map((role) => ({ group, role })) });
    }
    if (resultUnitIds.length > 0) {
      await tx.groupResultUnit.createMany({
        data: resultUnitIds.map((resultUnitId) => ({ group, resultUnitId })),
      });
    }

    return reapplyGrants(tx);
  });
  if (!done.ok) return fail(409, "authority.wouldLockOut");

  return NextResponse.json({ affected: done.value });
}

export async function DELETE(req: Request) {
  const g = await admin();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, DeleteGroupGrant);
  if (!parsed.ok) return parsed.res;
  const { group } = parsed.data;

  const done = await changeAuthority(async (tx) => {
    await tx.groupRole.deleteMany({ where: { group } });
    await tx.groupResultUnit.deleteMany({ where: { group } });
    return reapplyGrants(tx);
  });
  if (!done.ok) return fail(409, "authority.wouldLockOut");

  return NextResponse.json({ affected: done.value });
}
