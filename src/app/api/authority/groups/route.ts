// The roles one Authentik group gives, the whole set per request (admin only). Result units are set on the unit
// (api/result-units/[id]/groups) and stock places on the place. One transaction replaces its rows, re-derives everyone whose stored group list touches it
// (lib/server/authentik-roles.ts), and checks that somebody can still open Inställningar, rolling back otherwise.
import { NextResponse } from "next/server";
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
  const { group, roles } = parsed.data;

  // A group outside `dsek.` is not the section's and confers nothing: refused here rather than stored and ignored at sign-in.
  if (!isSectionGroup(group))
    return fail(422, "authority.groupOutsideSection", { values: { group } });

  // Rolled back if it would leave nobody able to reach Inställningar. See changeAuthority: serializable catches a
  // concurrent write to a different group's rows.
  const done = await changeAuthority(async (tx) => {
    await tx.groupRole.deleteMany({ where: { group } });
    if (roles.length > 0) {
      await tx.groupRole.createMany({ data: roles.map((role) => ({ group, role })) });
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
    return reapplyGrants(tx);
  });
  if (!done.ok) return fail(409, "authority.wouldLockOut");

  return NextResponse.json({ affected: done.value });
}
