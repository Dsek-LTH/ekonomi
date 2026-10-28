// Set the short names of cost centres: what each is called under its result
// unit's heading. Any cost centre, Fortnox ones included, since the short name
// is this app's own and the sync never writes it. See `shortName` in the schema.
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
