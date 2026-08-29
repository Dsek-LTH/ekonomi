// The products the bar keeps a stock of.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateStockProduct } from "@/lib/api/schemas/stock";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockProducts } from "@/lib/data/stock";
import { eanTaken, isCollision, nameTaken } from "@/lib/server/stock-product-guard";

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

  // Which size a product needs follows from its kind, which is why the schema
  // cannot say it. A spirit that never had its bottle size set is a product
  // whose levels mean nothing — 40 % of what? — and a can with no volume leaves
  // itself out of the restaurangrapport's litres. Both are settled when the
  // product is made rather than discovered by the first person holding a crate.
  if (body.kind === "VOLUME" && !body.nominalMl) {
    return fail(422, "stock.calibrationNoVolume");
  }
  if (body.kind === "UNIT" && !body.unitMl) {
    return fail(422, "stock.sizeRequired");
  }

  // Said in words, and about a particular product. A bare "that did not save"
  // leaves somebody holding a tin with nowhere to go; naming the owner — and
  // saying when the owner is retired rather than in use — turns the refusal
  // into an instruction.
  const clash = (await eanTaken(body.ean)) ?? (await nameTaken(body.name));
  if (clash) return clash;

  const product = await prisma.stockProduct.create({
    data: {
      name: body.name,
      kind: body.kind,
      category: body.category,
      abv: body.abv ?? null,
      unitMl: body.unitMl ?? null,
      nominalMl: body.nominalMl ?? null,
      ean: body.ean ?? null,
      costPriceOre: body.costPriceOre ?? null,
      systembolagetId: body.systembolagetId ?? null,
    },
    select: { id: true },
  }).catch((err: unknown) => {
    // The same collision, arriving between the check above and this line.
    // Vanishingly rare and still worth answering properly.
    if (isCollision(err)) return null;
    throw err;
  });
  if (!product) return fail(409, "stock.eanTaken", { values: { name: body.name } });
  return NextResponse.json({ id: product.id }, { status: 201 });
}
