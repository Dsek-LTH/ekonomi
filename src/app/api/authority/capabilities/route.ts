// The finished capability set for a role, replacing what it held (admin only). The lockout check runs against
// the outcome inside the transaction. Capabilities are resolved per request from this table
// (lib/server/capabilities.ts), so nothing is re-derived here.
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

  // Rolled back if it would leave nobody able to reach Inställningar (changeAuthority).
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
