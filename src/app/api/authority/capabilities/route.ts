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
import { serializable } from "@/lib/server/tx";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { someoneCanReachSettings } from "@/lib/server/capabilities";
import { PutRoleCapabilities } from "@/lib/api/schemas/admin";

/** Raised inside the transaction to roll it back with a reason. */
class Lockout extends Error {}

export async function PUT(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PutRoleCapabilities);
  if (!parsed.ok) return parsed.res;
  const { role, capabilities } = parsed.data;

  try {
    // Serializable, not merely transactional. The lockout check below is a
    // read-modify-write, and at READ COMMITTED two concurrent unticks of
    // SETTINGS (one per role, which is two clicks on the grid) each observe
    // the other's role still holding it. Both pass. Both commit. Nobody can open
    // the door again, and the check that exists to prevent exactly that saw
    // nothing wrong either time.
    await serializable(async (tx) => {
      await tx.roleCapability.deleteMany({ where: { role } });
      if (capabilities.length > 0) {
        await tx.roleCapability.createMany({
          data: capabilities.map((capability) => ({ role, capability })),
        });
      }

      // Not "did you just untick SETTINGS": whether anybody is left who can
      // open the door. Taking it from a role nobody holds is fine, and taking
      // it from the last role that anybody holds is not, and only counting
      // people can tell those apart.
      if (!(await someoneCanReachSettings(tx))) throw new Lockout();
    });

    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof Lockout) return fail(409, "authority.wouldLockOut");
    throw err;
  }
}
