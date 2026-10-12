// What one role may do (admin only).
//
// The finished capability set for a role, replacing whatever it held. Same shape
// and same reasoning as the group grants next door: a row saved as a unit, and
// the lockout check run against the outcome inside the transaction that made it.
//
// Nothing is re-derived here. Capabilities are resolved per request from this
// table (lib/server/capabilities.ts) rather than stored on anybody's row, so the
// next request after this one is already decided by the new grid. There is no
// thousand-row rewrite to do, which is exactly why they are not stored.
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { changeAuthority } from "@/lib/server/authority-change";
import { PutRoleCapabilities } from "@/lib/api/schemas/admin";

export async function PUT(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PutRoleCapabilities);
  if (!parsed.ok) return parsed.res;
  const { role, capabilities } = parsed.data;

  // Refused, and rolled back, if it would leave nobody able to reach
  // Inställningar. See changeAuthority.
  const done = await changeAuthority(async (tx) => {
    await tx.roleCapability.deleteMany({ where: { role } });
    if (capabilities.length > 0) {
      await tx.roleCapability.createMany({
        data: capabilities.map((capability) => ({ role, capability })),
      });
    }
  });
  if (!done.ok) return fail(409, "authority.wouldLockOut");

  return new Response(null, { status: 204 });
}
