// Edit a product, or retire one.
//
// The product is editable and the log is not, which is the right way round: a
// name corrected or a tare re-measured should apply everywhere the product
// appears, while what happened on a Friday in March is settled. Re-measuring a
// tare is in fact the reason the readings are stored — see the entries route.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchStockProduct } from "@/lib/api/schemas/stock";
import { canManageStock } from "@/lib/domain/permissions";
import { eanTaken, nameTaken } from "@/lib/server/stock-product-guard";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PatchStockProduct);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const existing = await prisma.stockProduct.findUnique({
    where: { id },
    select: { kind: true, nominalMl: true },
  });
  if (!existing) return fail(404, "stock.productNotFound");

  // Checked against what the edit leaves behind rather than what it sends: a
  // patch that clears the bottle size is as unusable as one that never had it,
  // and it is a patch that would otherwise go through.
  const after = { ...existing, ...body };
  if (after.kind === "VOLUME" && !after.nominalMl) {
    return fail(422, "stock.calibrationNoVolume");
  }

  // Excluding this product, so leaving its own barcode alone is not a clash
  // with itself.
  if (body.ean) {
    const clash = await eanTaken(body.ean, id);
    if (clash) return clash;
  }
  if (body.name) {
    const clash = await nameTaken(body.name, id);
    if (clash) return clash;
  }

  const updated = await orNotFound(
    () =>
      prisma.stockProduct.update({
        where: { id },
        data: {
          name: body.name,
          kind: body.kind,
          category: body.category,
          abv: body.abv,
          unitMl: body.unitMl,
          nominalMl: body.nominalMl,
          ean: body.ean,
          costPriceOre: body.costPriceOre,
        },
        select: { id: true },
      }),
    "stock.productNotFound",
  );
  if (updated instanceof NextResponse) return updated;

  return new Response(null, { status: 204 });
}

/**
 * Delete a product nothing has ever been recorded against.
 *
 * A product with movements is never deleted: every row of the log points at it,
 * and a log whose products can vanish is a log that stops being readable the
 * first time somebody tidies up. It used to be retired instead — kept out of
 * the pickers, kept on the historical rows — which was a second kind of product
 * that every picker, scan and check had to know about.
 *
 * So the protection stays and the hidden state does not: a product that has
 * been used is refused, in words, and stays exactly what it was. What is left
 * to delete is the case this is actually for — a product typed wrong a minute
 * ago and never booked on.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const used = await prisma.stockEntry.count({ where: { productId: id } });
  if (used > 0) return fail(409, "stock.productInUse", { values: { count: used } });

  const gone = await orNotFound(
    () => prisma.stockProduct.delete({ where: { id } }),
    "stock.productNotFound",
  );
  if (gone instanceof NextResponse) return gone;
  return new Response(null, { status: 204 });
}
