// One occasion, with what it moved per product.
//
// The register reads this to know how much of a night is still unaccounted for:
// that figure is the ceiling on anything coming back or being written off, and
// it is the same number the tag's page calls sold. Those are the same thing
// until somebody carries the crates back, which is the ambiguity a tag that is
// never closed accepts on purpose.
import { NextResponse } from "next/server";
import { fail, gate } from "@/lib/api/guard";
import { canViewStock } from "@/lib/domain/permissions";
import { getStockTag } from "@/lib/data/stock";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canViewStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const tag = await getStockTag(id);
  if (!tag) return fail(404, "stock.tagNotFound");
  return NextResponse.json(tag);
}
