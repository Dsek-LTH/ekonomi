// Find a product by the barcode on it.
//
// The cellar's entry point: scan a tin, get the product, register the movement
// without typing a name. A miss is a 404 rather than an empty list: "no
// product has this barcode" is the answer, and it is what the screen offers to
// fix by creating one.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { canViewStock } from "@/lib/domain/permissions";

export async function GET(req: Request) {
  const g = await gate(canViewStock, "stock.noAccess");
  if (!g.ok) return g.res;

  // Digits only, and the length a barcode actually is. A scanner that misreads
  // returns rubbish, and looking rubbish up is a query that can only miss.
  const ean = (new URL(req.url).searchParams.get("ean") ?? "").trim();
  if (!/^\d{8,14}$/.test(ean)) return fail(422, "stock.eanInvalid");

  const product = await prisma.stockProduct.findUnique({
    where: { ean },
    select: { id: true, name: true, kind: true },
  });
  if (!product) return fail(404, "stock.eanUnknown");
  return NextResponse.json(product);
}
