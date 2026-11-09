// Edit a product, or delete it and its log.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchStockProduct } from "@/lib/api/schemas/stock";
import { canManageStock } from "@/lib/domain/permissions";
import {
  eanTaken,
  nameTaken,
  nextInternalCode,
  typedInternalCode,
} from "@/lib/server/stock-product-guard";
import { isInternalCode } from "@/lib/stock/barcode";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PatchStockProduct);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // Everything a patch may touch, so the change log can say what each field was.
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

  // Checked against what the edit leaves behind: clearing the bottle size makes it unusable.
  const after = { ...existing, ...body };
  if (after.kind === "VOLUME" && !after.nominalMl) {
    return fail(422, "stock.calibrationNoVolume");
  }

  // Excluding this product, so keeping its own barcode is not a clash. Marked as having none: keep
  // its own code if it has one, else give it one.
  if (body.noBarcode) {
    body.ean = isInternalCode(existing.ean) ? existing.ean! : await nextInternalCode();
  } else if (typedInternalCode(body.ean, existing.ean)) {
    return fail(422, "stock.internalCodeTyped");
  }

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
    // `undefined` leaves the list; an empty list is a real edit.
    tags: body.tags,
  };

  /**
   * What this patch actually changes, field by field, compared as text (read by a person, see
   * StockProductChange). The price change is silent by design: it only affects the next delivery
   * (StockEntry.unitCostOre), so it must be traceable.
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
        const row = await tx.stockProduct.update({
          where: { id },
          data,
          select: { id: true },
        });
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
 * Delete a product and everything the log holds about it. The shelf's value changes retroactively
 * and purchased volumes behind a filed restaurangrapport stop reproducing, so a reported product
 * should be corrected rather than deleted. The order is the foreign key order (all `Restrict` in
 * the schema, so this stays the only route that can delete):
 *   1. `correctsId` cleared first (Postgres checks RESTRICT immediately, not at statement end).
 *   2. The entries. 3. The change trail. 4. The product (lots and edits cascade).
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
