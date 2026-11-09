// The caller's own Fortnox bookkeeping session. Login is the OAuth flow (/api/fortnox/connect?mode=user); this only ends it early.
import { clearUserSession } from "@/lib/fortnox";
import { gate } from "@/lib/api/guard";

export async function DELETE() {
  const g = await gate();
  if (!g.ok) return g.res;

  await clearUserSession(g.actor.id);
  return new Response(null, { status: 204 });
}
