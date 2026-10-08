import "server-only";

import { someoneCanReachSettings } from "@/lib/server/capabilities";
import { serializable, type TxClient } from "@/lib/server/tx";

/** Raised inside the transaction to roll it back with a reason. */
class Lockout extends Error {}

/**
 * A change to who may do what (a group's grants, a role's capabilities), made
 * so that it can never leave the section without anybody able to reach
 * Inställningar to undo it.
 *
 * Serializable, not merely transactional. The lockout check is a
 * read-modify-write, and at READ COMMITTED two concurrent unticks of SETTINGS
 * (one per role, which is two clicks on the grid) each observe the other's
 * role still holding it. Both pass. Both commit. Nobody can open the door
 * again, and the check that exists to prevent exactly that saw nothing wrong
 * either time.
 *
 * Not "did you just untick SETTINGS": whether anybody is left who can open the
 * door. Taking it from a role nobody holds is fine, and taking it from the
 * last role that anybody holds is not, and only counting people can tell
 * those apart.
 *
 * Returns what `change` returned, or `{ ok: false }` when it was rolled back
 * for locking everyone out. The three routes that change authority each used
 * to carry their own copy of this.
 */
export async function changeAuthority<T>(
  change: (tx: TxClient) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    const value = await serializable(async (tx) => {
      const result = await change(tx);
      if (!(await someoneCanReachSettings(tx))) throw new Lockout();
      return result;
    });
    return { ok: true, value };
  } catch (err) {
    if (err instanceof Lockout) return { ok: false };
    throw err;
  }
}
