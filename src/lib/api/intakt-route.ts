// What the two income import routes (Zettle and Swish) do before asking intakt
// for anything: find who is asking, and build the service's config with them
// as the one who attests the reports. Kept beside fortnox-route.ts for the same
// reason that file exists: lib/income/ talks to the service and knows nothing
// about requests.
import type { NextResponse } from "next/server";
import { fail } from "@/lib/api/guard";
import { buildIntaktConfig } from "@/lib/income/config";
import { loadUser } from "@/lib/server/current-user";

type IntaktConfig = Extract<Awaited<ReturnType<typeof buildIntaktConfig>>, { ok: true }>["config"];

/**
 * The config to send intakt for a fetch run by `actorId`.
 *
 * The report is attested by whoever asked for it. intakt's config.yaml named
 * one treasurer, so every report it ever produced carried their name no matter
 * who ran it; here it is simply the signed-in user.
 */
export async function intaktConfigFor(
  actorId: string,
): Promise<{ ok: true; config: IntaktConfig } | { ok: false; res: NextResponse }> {
  const user = await loadUser(actorId);
  if (!user) return { ok: false, res: fail(401, "auth.signedOut") };

  const cfg = await buildIntaktConfig({ name: user.name, studentId: user.studentId });
  if (!cfg.ok) {
    return {
      ok: false,
      res: fail(409, `income.${cfg.blocker}`, {
        ...(cfg.detail && { values: { detail: cfg.detail } }),
      }),
    };
  }
  return { ok: true, config: cfg.config };
}
