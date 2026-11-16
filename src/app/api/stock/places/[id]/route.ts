// One place, changed. A change to its groups or to whether it is archived changes who may log moves, so everyone's
// stored places are derived again in the same transaction, the way a mapping edit in Roller does.

import { NextResponse } from "next/server";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchStockPlace } from "@/lib/api/schemas/stock";
import { isSectionGroup, normaliseGroup } from "@/lib/domain/group-name";
import { canAccessSettings } from "@/lib/domain/permissions";
import { reapplyGrants } from "@/lib/server/authentik-roles";
import { prisma } from "@/lib/server/db";
import { isCollision } from "@/lib/server/stock-product-guard";
import { serializable } from "@/lib/server/tx";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;

  const parsed = await parseBody(req, PatchStockPlace);
  if (!parsed.ok) return parsed.res;
  const { groups: rawGroups, ...fields } = parsed.data;

  const place = await prisma.stockPlace.findUnique({ where: { id }, select: { id: true } });
  if (!place) return fail(404, "stock.placeNotFound");

  // A group outside `dsek.` confers nothing at sign-in, so it is refused here rather than stored and ignored.
  const groups = rawGroups && [...new Set(rawGroups.map(normaliseGroup))];
  const outside = groups?.find((group) => !isSectionGroup(group));
  if (outside) return fail(422, "authority.groupOutsideSection", { values: { group: outside } });

  if (fields.costCenterId) {
    const found = await prisma.costCenter.count({ where: { id: fields.costCenterId } });
    if (!found) return fail(404, "costCenter.notFound");
  }

  const changesWho = groups !== undefined || fields.archived !== undefined;
  const done = await serializable(async (tx) => {
    await tx.stockPlace.update({ where: { id }, data: fields });
    if (groups !== undefined) {
      await tx.stockPlaceGroup.deleteMany({ where: { placeId: id } });
      if (groups.length > 0) {
        await tx.stockPlaceGroup.createMany({
          data: groups.map((group) => ({ group, placeId: id })),
        });
      }
    }
    return changesWho ? reapplyGrants(tx) : 0;
  }).catch((err: unknown) => {
    if (isCollision(err)) return null;
    throw err;
  });
  if (done === null) return fail(409, "stock.placeNameTaken");
  return NextResponse.json({ affected: done });
}

/**
 * Delete a place nothing has moved to or from. One with movements is archived instead: the log and the vouchers
 * already sent name it. Whoever held it through a group loses it at once.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;

  const place = await prisma.stockPlace.findUnique({
    where: { id },
    select: { _count: { select: { entries: true } } },
  });
  if (!place) return fail(404, "stock.placeNotFound");
  if (place._count.entries > 0) return fail(409, "stock.placeInUse");

  await serializable(async (tx) => {
    // Its groups go with it (cascade).
    await tx.stockPlace.delete({ where: { id } });
    return reapplyGrants(tx);
  });
  return new Response(null, { status: 204 });
}
