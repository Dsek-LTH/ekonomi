import "server-only";

// Product form checks a schema cannot catch (is this value already somebody else's, and whose), shared by create and edit.

import { prisma } from "./db";
import { INTERNAL_PREFIX, internalCode, internalNumber, isInternalCode } from "@/lib/stock/barcode";
import { fail } from "@/lib/api/guard";
import type { NextResponse } from "next/server";
import type { DrinkCategory } from "@/lib/domain/types";
import type { StockSlug } from "@/lib/stock/stocks";
import { CATEGORIES } from "@/lib/domain/categories";

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

/**
 * The group a drink type's products are booked under, in a stock that files the restaurangrapport. There the drink
 * type is the only classification anybody picks (Folkhälsomyndigheten's), and the group is only where its accounts
 * live: one per drink type, made on first use. A group of the right name that is not linked yet is linked.
 */
export async function categoryGroup(stock: StockSlug, category: DrinkCategory): Promise<string> {
  const linked = await prisma.stockGroup.findUnique({ where: { category }, select: { id: true } });
  if (linked) return linked.id;
  const name = CATEGORY_GROUP_NAME[category];
  const named = await prisma.stockGroup.findFirst({
    where: { stockId: stock, name, category: null },
    select: { id: true },
  });
  if (named) {
    await prisma.stockGroup.update({ where: { id: named.id }, data: { category } });
    return named.id;
  }
  try {
    const made = await prisma.stockGroup.create({
      data: { stockId: stock, name, category, sortOrder: CATEGORIES.indexOf(category) },
      select: { id: true },
    });
    return made.id;
  } catch (e) {
    // Made by a save a moment ago.
    if (!isCollision(e)) throw e;
    const again = await prisma.stockGroup.findUniqueOrThrow({
      where: { category },
      select: { id: true },
    });
    return again.id;
  }
}

/** What a drink type's group is called where it is made, Folkhälsomyndigheten's own word for it. */
const CATEGORY_GROUP_NAME: Record<DrinkCategory, string> = {
  OL: "Öl",
  OVRIG_JASTDRYCK: "Övrig jästdryck",
  VIN: "Vin",
  SPRITDRYCK: "Spritdryck",
  ALKOHOLDRYCKSLIKNANDE: "Alkoholdrycksliknande preparat",
};
