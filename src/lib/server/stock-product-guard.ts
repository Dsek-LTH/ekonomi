import "server-only";

// The things a product form gets wrong that a schema cannot catch.
//
// A shape check answers "is this the right sort of value"; these answer "is
// this value already somebody else's, and which somebody". The difference
// matters to whoever is holding the tin: "the barcode is taken" sends them
// looking, "the barcode belongs to Norrlands Guld, which is retired" tells them
// what to do about it.
//
// Kept out of the routes because both of them need it: a product can collide
// on the way in and on the way to being edited, and a rule written twice is a
// rule that will be right once.

import { prisma } from "./db";
import { INTERNAL_PREFIX, internalCode, internalNumber, isInternalCode } from "@/lib/stock/barcode";
import { fail } from "@/lib/api/guard";
import type { NextResponse } from "next/server";

/** Whether a Prisma failure is a unique-index collision. */
export const isCollision = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

/**
 * Whether this barcode is free, and a sentence naming its owner if not.
 *
 * `self` is the product being edited, so a patch that leaves its own barcode
 * alone is not a collision with itself.
 *
 * A retired owner gets its own message. Scanning something the cellar used to
 * stock and being told the code is taken, with no hint that the product is
 * sitting one tab away waiting to be reactivated, is how a second Norrlands
 * Guld gets created under a barcode that then has to be invented.
 */
export async function eanTaken(ean: string, self?: string): Promise<NextResponse | null> {
  const owner = await prisma.stockProduct.findUnique({
    where: { ean },
    select: { id: true, name: true },
  });
  if (!owner || owner.id === self) return null;
  return fail(409, "stock.eanTaken", { values: { name: owner.name } });
}

/**
 * A product whose name is already in use.
 *
 * Not a unique index: a guild really can stock "Husets vin" in two sizes. It is
 * a refusal here because the barcode already has to differ, so two products
 * sharing a name are far more often a slip than an intent.
 */
export async function nameTaken(name: string, self?: string): Promise<NextResponse | null> {
  const twin = await prisma.stockProduct.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, id: { not: self } },
    select: { id: true, name: true },
  });
  return twin ? fail(409, "stock.nameTaken", { values: { name: twin.name } }) : null;
}

/**
 * The next of the section's own barcodes, for a product said to have none: one
 * past the highest given out so far. See lib/stock/barcode.ts.
 *
 * Read and then written in two steps, so two products made in the same instant
 * could be handed the same number. The unique index on the barcode refuses the
 * second, which the route answers as a collision to try again; at a few kegs a
 * term that is not worth a lock.
 */
export async function nextInternalCode(): Promise<string> {
  const rows = await prisma.stockProduct.findMany({
    where: { ean: { startsWith: INTERNAL_PREFIX } },
    select: { ean: true },
  });
  const highest = rows.reduce((n, r) => Math.max(n, internalNumber(r.ean ?? "") ?? 0), 0);
  return internalCode(highest + 1);
}

/**
 * A barcode in the section's own range that this product was not given. The
 * range is the app's to hand out, so one is never typed in: typed, it could be
 * the next one the app means to give a keg.
 */
export function typedInternalCode(ean: string | undefined, current?: string | null): boolean {
  return Boolean(ean) && isInternalCode(ean) && ean !== current;
}
