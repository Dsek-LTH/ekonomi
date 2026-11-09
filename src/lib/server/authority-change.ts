import "server-only";

import { someoneCanReachSettings } from "@/lib/server/capabilities";
import { serializable, type TxClient } from "@/lib/server/tx";

/** Raised inside the transaction to roll it back with a reason. */
class Lockout extends Error {}

/**
 * A change to who may do what, made so it can never leave nobody able to reach Inställningar. Serializable:
 * at READ COMMITTED two concurrent unticks of SETTINGS each see the other's role still holding it and both
 * commit. The check counts who is left, not whether SETTINGS was unticked. Returns what `change` returned,
 * or `{ ok: false }` when rolled back for locking everyone out.
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
