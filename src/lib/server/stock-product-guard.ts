import "server-only";

// Product form checks a schema cannot catch (is this value already somebody else's, and whose), shared by create and edit.

import { prisma } from "./db";
import { INTERNAL_PREFIX, internalCode, internalNumber, isInternalCode } from "@/lib/stock/barcode";
import { fail } from "@/lib/api/guard";
import type { NextResponse } from "next/server";
import type { DrinkCategory } from "@/lib/domain/types";
import type { StockSlug } from "@/lib/stock/stocks";

/** Whether a Prisma failure is a unique-index collision. */
export const isCollision = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

/**
 * Whether this barcode is free, and a sentence naming its owner if not. `self` is the product being edited.
 * A retired owner gets its own message, pointing at reactivation.
 */
export async function eanTaken(ean: string, self?: string): Promise<NextResponse | null> {
  const owner = await prisma.stockProduct.findUnique({
    where: { ean },
    select: { id: true, name: true },
  });
  if (!owner || owner.id === self) return null;
  return fail(409, "stock.eanTaken", { values: { name: owner.name } });
}

/** A product whose name is already in use. Not a unique index (a guild can stock "Husets vin" in two sizes), but a slip more often than not. */
export async function nameTaken(name: string, self?: string): Promise<NextResponse | null> {
  const twin = await prisma.stockProduct.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, id: { not: self } },
    select: { id: true, name: true },
  });
  return twin ? fail(409, "stock.nameTaken", { values: { name: twin.name } }) : null;
}

/**
 * The next of the section's own barcodes: one past the highest given out. See lib/stock/barcode.ts.
 * Two simultaneous products could get the same number; the unique index refuses the second and the route retries.
 */
export async function nextInternalCode(): Promise<string> {
  const rows = await prisma.stockProduct.findMany({
    where: { ean: { startsWith: INTERNAL_PREFIX } },
    select: { ean: true },
  });
  const highest = rows.reduce((n, r) => Math.max(n, internalNumber(r.ean ?? "") ?? 0), 0);
  return internalCode(highest + 1);
}

/** A barcode in the section's own range that this product was not given. The app hands those out, so one is never typed in. */
export function typedInternalCode(ean: string | undefined, current?: string | null): boolean {
  return Boolean(ean) && isInternalCode(ean) && ean !== current;
}

/**
 * The group a product goes in: the one named, if it is this stock's, else the one its drink category
 * is pre-selected for, else the stock's only group. Null when none of those settles it.
 */
export async function resolveGroup(
  stock: StockSlug,
  groupId: string | undefined,
  category: DrinkCategory | null | undefined,
): Promise<string | null> {
  const groups = await prisma.stockGroup.findMany({
    where: { stockId: stock },
    select: { id: true, category: true },
  });
  if (groupId) return groups.some((g) => g.id === groupId) ? groupId : null;
  const byCategory = category ? groups.find((g) => g.category === category) : undefined;
  if (byCategory) return byCategory.id;
  return groups.length === 1 ? groups[0].id : null;
}
