// Take a personal grant away. The row is deleted: no history is kept. Goes through the lockout check, since a
// grant with no end may be what keeps somebody able to reach Inställningar.
import { canGrantAccess } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { changeAuthority } from "@/lib/server/authority-change";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canGrantAccess, "auth.grantAccessOnly");
  if (!g.ok) return g.res;

  const { id } = await ctx.params;
  const done = await changeAuthority((tx) => tx.accessGrant.deleteMany({ where: { id } }));
  if (!done.ok) return fail(409, "authority.wouldLockOut");
  if (done.value.count === 0) return fail(404, "notFound");

  return new Response(null, { status: 204 });
}
