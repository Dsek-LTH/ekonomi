import { canAccessSettings } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PutCostCenterShortNames } from "@/lib/api/schemas/admin";
import { setCostCenterShortNames } from "@/lib/data/cost-centers";

export async function PUT(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminEditCostCenter");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PutCostCenterShortNames);
  if (!parsed.ok) return parsed.res;

  await setCostCenterShortNames(parsed.data.names);
  return new Response(null, { status: 204 });
}
