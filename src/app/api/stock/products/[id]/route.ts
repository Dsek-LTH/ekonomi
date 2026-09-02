// Edit a product, or delete it and its log.
//
// The product is editable and the log is not, which is the right way round: a
// name corrected or a tare re-measured should apply everywhere the product
// appears, while what happened on a Friday in March is settled. Re-measuring a
// tare is in fact the reason the readings are stored, see the entries route.
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

  // Everything a patch may touch, so the change log below can say what each
  // field was before somebody changed it.
  const existing = await prisma.stockProduct.findUnique({
    where: { id },
    select: {
      kind: true,
      name: true,
      category: true,
      abv: true,
      unitMl: true,
      nominalMl: true,
      ean: true,
      costPriceOre: true,
      shelfLifeMonths: true,
      systembolagetId: true,
      tags: true,
    },
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

  const data = {
    name: body.name,
    kind: body.kind,
    category: body.category,
    abv: body.abv,
    unitMl: body.unitMl,
    nominalMl: body.nominalMl,
    ean: body.ean,
    costPriceOre: body.costPriceOre,
    shelfLifeMonths: body.shelfLifeMonths,
    systembolagetId: body.systembolagetId,
    // `undefined` leaves the list as it is; an empty list is a real edit,
    // the one that takes the last tag off a product.
    tags: body.tags,
  };

  /**
   * What this patch actually changes, field by field.
   *
   * A patch carries whatever the form had, most of it identical to what is
   * already stored, so "what was sent" is not the same question as "what
   * changed" and only the second is worth recording. Compared as text, which is
   * also how it is kept: this is read by a person asking who typed 149, not
   * computed on. See the schema note on StockProductChange.
   *
   * The price is the field this exists for. It decides what the *next* delivery
   * is booked at and nothing before it (see StockEntry.unitCostOre), so a
   * change here is silent by design, and a silent change to a figure that
   * values a cellar is one somebody has to be able to look up afterwards.
   */
  const asText = (v: unknown): string | null =>
    v == null ? null : Array.isArray(v) ? v.join(", ") : String(v);
  const edits = Object.entries(data).flatMap(([field, next]) => {
    if (next === undefined) return [];
    const before = asText(existing[field as keyof typeof existing]);
    const after = asText(next);
    return before === after ? [] : [{ field, fromValue: before, toValue: after }];
  });

  const updated = await orNotFound(
    () =>
      prisma.$transaction(async (tx) => {
        const row = await tx.stockProduct.update({ where: { id }, data, select: { id: true } });
        if (edits.length > 0) {
          await tx.stockProductChange.createMany({
            data: edits.map((e) => ({ ...e, productId: id, actorId: g.actor.id })),
          });
        }
        return row;
      }),
    "stock.productNotFound",
  );
  if (updated instanceof NextResponse) return updated;

  return new Response(null, { status: 204 });
}

/**
 * Delete a product, and everything the log holds about it.
 *
 * This used to refuse a product with movements on it, and the refusal was the
 * point: every row of the log points at a product, and a log whose products can
 * vanish stops being readable the first time somebody tidies up. What that
 * argument missed is that a product typed wrong is often only noticed after it
 * has been booked on, and the app then had no way out of it at all.
 *
 * So it goes, and the rows go with it. Two things follow, and both are said out
 * loud on the screen that asks. The shelf's value changes retroactively, since
 * it is the sum of `valueDeltaOre` over rows that no longer exist. And the
 * purchased volumes behind a filed restaurangrapport stop reproducing, so a
 * product that has been reported on should be corrected rather than deleted.
 *
 * The order below is the dependency order, and every step of it is a foreign
 * key this app deliberately declared `Restrict` (see the schema). Nothing here
 * relaxes those: a stray `stockProduct.delete` anywhere else still fails, which
 * is what keeps this the only route that can do it.
 *
 *   1. `correctsId` is cleared first. A correction names the row it corrects,
 *      always one of the same product's, and Postgres checks a RESTRICT
 *      reference the moment the row goes rather than at the end of the
 *      statement, so a single deleteMany over both would refuse itself.
 *   2. The entries, which is the log.
 *   3. The change trail, which is keyed to the product rather than to the rows.
 *   4. The product, whose lots and edits are `Cascade` and follow it.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const gone = await orNotFound(
    () =>
      prisma.$transaction(async (tx) => {
        await tx.stockEntry.updateMany({
          where: { productId: id, correctsId: { not: null } },
          data: { correctsId: null },
        });
        const entries = await tx.stockEntry.deleteMany({ where: { productId: id } });
        await tx.stockChange.deleteMany({ where: { productId: id } });
        await tx.stockProduct.delete({ where: { id } });
        return { entries: entries.count };
      }),
    "stock.productNotFound",
  );
  if (gone instanceof NextResponse) return gone;
  return NextResponse.json(gone);
}
