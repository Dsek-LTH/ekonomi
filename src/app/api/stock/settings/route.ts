// The stock feature's own settings. One row, like BookkeepingSettings.
//
// Everything here is a policy: a number somebody chose, rather than a fact the
// world handed us. Facts about a product live on the product, which is why the
// shelf life is over there and the notice period is here. See StockSettings in
// the schema.
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateStockSettings } from "@/lib/api/schemas/stock";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";

export async function PATCH(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateStockSettings);
  if (!parsed.ok) return parsed.res;

  // Upsert rather than update: nothing seeds this row, and an installation that
  // has never opened the page should store the setting rather than fail on its
  // absence. The default lives in the column, so a missing row and an untouched
  // one mean the same thing.
  await prisma.stockSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...parsed.data },
    update: parsed.data,
  });

  return new Response(null, { status: 204 });
}
