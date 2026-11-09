// The products the bar keeps a stock of.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateStockProduct } from "@/lib/api/schemas/stock";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockProducts } from "@/lib/data/stock";
import {
  eanTaken,
  isCollision,
  nameTaken,
  nextInternalCode,
  typedInternalCode,
} from "@/lib/server/stock-product-guard";

export async function GET() {
  const g = await gate(canViewStock, "stock.noAccess");
  if (!g.ok) return g.res;
  return NextResponse.json(await getStockProducts());
}

export async function POST(req: Request) {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateStockProduct);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // The needed size follows from the kind, which the schema cannot say: a spirit without bottle size
  // has meaningless levels, a can without volume drops out of the restaurangrapport's litres.
  if (body.kind === "VOLUME" && !body.nominalMl) {
    return fail(422, "stock.calibrationNoVolume");
  }
  if (body.kind === "UNIT" && !body.unitMl) {
    return fail(422, "stock.sizeRequired");
  }

  // Names the owner (and whether retired) so the refusal is an instruction. A barcode, or none:
  // then it gets one of the section's own (lib/stock/barcode.ts).
  if (!body.noBarcode && !body.ean) return fail(422, "stock.eanRequired");
  if (!body.noBarcode && typedInternalCode(body.ean)) return fail(422, "stock.internalCodeTyped");
  const ean = body.noBarcode ? await nextInternalCode() : body.ean!;

  const clash = (await eanTaken(ean)) ?? (await nameTaken(body.name));
  if (clash) return clash;

  const product = await prisma.stockProduct
    .create({
      data: {
        name: body.name,
        kind: body.kind,
        category: body.category,
        abv: body.abv ?? null,
        unitMl: body.unitMl ?? null,
        nominalMl: body.nominalMl ?? null,
        ean,
        costPriceOre: body.costPriceOre ?? null,
        shelfLifeMonths: body.shelfLifeMonths ?? null,
        systembolagetId: body.systembolagetId ?? null,
        // Cleaned by the schema; the fallback is only for a missing field.
        tags: body.tags ?? [],
      },
      select: { id: true },
    })
    .catch((err: unknown) => {
      // The same collision, arriving between the check and the write.
      if (isCollision(err)) return null;
      throw err;
    });
  if (!product) return fail(409, "stock.eanTaken", { values: { name: body.name } });
  return NextResponse.json({ id: product.id }, { status: 201 });
}
