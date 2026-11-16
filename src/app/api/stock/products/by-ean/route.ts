// Find a product by the barcode on it. A miss is a 404, which the screen offers to fix by creating one.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail } from "@/lib/api/guard";
import { gateStock } from "@/lib/api/stock-gate";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const g = await gateStock(url.searchParams.get("stock"), "enter");
  if (!g.ok) return g.res;

  // Digits only, and a real barcode length.
  const ean = (url.searchParams.get("ean") ?? "").trim();
  if (!/^\d{8,14}$/.test(ean)) return fail(422, "stock.eanInvalid");

  const product = await prisma.stockProduct.findUnique({
    where: { ean },
    select: { id: true, name: true, kind: true, stockId: true },
  });
  // A barcode the other stock holds is not this stock's product. Creating it here is refused by name.
  if (!product || product.stockId !== g.stock) return fail(404, "stock.eanUnknown");
  return NextResponse.json({ id: product.id, name: product.name, kind: product.kind });
}
