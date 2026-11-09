// Find a product by the barcode on it. A miss is a 404, which the screen offers to fix by creating one.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { canViewStock } from "@/lib/domain/permissions";

export async function GET(req: Request) {
  const g = await gate(canViewStock, "stock.noAccess");
  if (!g.ok) return g.res;

  // Digits only, and a real barcode length.
  const ean = (new URL(req.url).searchParams.get("ean") ?? "").trim();
  if (!/^\d{8,14}$/.test(ean)) return fail(422, "stock.eanInvalid");

  const product = await prisma.stockProduct.findUnique({
    where: { ean },
    select: { id: true, name: true, kind: true },
  });
  if (!product) return fail(404, "stock.eanUnknown");
  return NextResponse.json(product);
}
