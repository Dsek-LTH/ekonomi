// Update a user's section roles (admin only). A user may hold several roles;
// access and attest authority are derived from the set in lib/domain/permissions.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { ROLES, canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import type { Role } from "@/lib/domain/types";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (!Array.isArray(body.roles)) return fail(422, "request.rolesList");
  const requested = [...new Set(body.roles)];
  if (requested.some((r) => !ROLES.includes(r as Role))) {
    return fail(422, "user.invalidRole");
  }
  // Never leave a user role-less.
  const roles = (requested.length ? requested : ["ORDINARIE"]) as Role[];

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return fail(404, "user.notFound");

  // Never leave the section without anyone who can reach Inställningar. This is
  // the one role change that cannot be undone from inside the app: the settings
  // view is where roles are edited, so taking the last holder's away locks the
  // door from the outside and the key is in the database.
  //
  // Asked through `canAccessSettings` rather than by naming the role, so it
  // stays true if the policy ever widens — and only asked on the path that
  // actually loses it.
  if (canAccessSettings(user.roles) && !canAccessSettings(roles)) {
    const others = await prisma.user.findMany({
      where: { id: { not: id } },
      select: { roles: true },
    });
    if (!others.some((u) => canAccessSettings(u.roles))) {
      return fail(409, "user.lastSettingsAdmin");
    }
  }

  const updated = await prisma.user.update({ where: { id }, data: { roles } });
  return NextResponse.json({ ok: true, roles: updated.roles });
}
