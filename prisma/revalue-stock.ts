// Works out every product's value column again, from the beginning.
//
//   pnpm stock:revalue            # report what would change, change nothing
//   pnpm stock:revalue --write    # write it
//
// The app replays a product's log after every write to it (lib/server/
// stock-replay.ts), so the stored figures are normally already the ones the
// rules produce. What that does not cover is the rules themselves changing, and
// they have: an arrival onto an empty shelf used to be worth nothing, which
// meant a cellar entered with the stocktake button (rather than as deliveries)
// was booked in at nothing, and stayed there. See lib/stock/value.ts.
//
// Nothing here decides anything. `replay` is the same function the app uses,
// given the same rows in the same order, so this cannot produce a valuation the
// app would not; it only reaches the rows nothing has written to since.
//
// Reporting is the default because this rewrites figures the books are read
// from, and reading the list first is the cheap way to find out it is wrong.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/lib/generated/prisma/client";
import { differs, replay, type ReplayRow } from "../src/lib/stock/replay";
import { loadEnvFile } from "./load-env";

loadEnvFile();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const kr = (ore: number) =>
  `${new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2 }).format(ore / 100)} kr`;

/** Swedish counts one of a thing differently from several, and a report that
 *  says "1 rader" reads as a report nobody looked at. */
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

async function main() {
  const write = process.argv.includes("--write");

  const products = await prisma.stockProduct.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, costPriceOre: true },
  });

  let touchedProducts = 0;
  let touchedRows = 0;
  let before = 0;
  let after = 0;
  const unpriced: string[] = [];

  for (const product of products) {
    const rows = await prisma.stockEntry.findMany({
      where: { productId: product.id },
      // The day it happened, then the order it was written: the same order the
      // app replays in, and the only tiebreak that is stable.
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        kind: true,
        level: true,
        units: true,
        open80: true,
        open60: true,
        open40: true,
        open20: true,
        countedQty: true,
        valueDeltaOre: true,
        unitCostOre: true,
      },
    });
    if (rows.length === 0) continue;

    const asRow = (r: (typeof rows)[number]): ReplayRow => ({
      id: r.id,
      kind: r.kind,
      level: r.level,
      units: r.units,
      open: { 80: r.open80, 60: r.open60, 40: r.open40, 20: r.open20 },
      countedQty: r.countedQty,
      valueDeltaOre: r.valueDeltaOre,
      unitCostOre: r.unitCostOre,
    });

    const settled = replay(rows.map(asRow));
    const was = rows.reduce((n, r) => n + r.valueDeltaOre, 0);
    const will = rows.reduce((n, r) => n + (settled.get(r.id)?.valueDeltaOre ?? 0), 0);
    before += was;
    after += will;

    const changed = rows.filter((r) => {
      const want = settled.get(r.id);
      return want && differs(asRow(r), want);
    });
    if (changed.length === 0) continue;

    touchedProducts++;
    touchedRows += changed.length;
    // A product nobody has priced cannot be valued by any of this, and is worth
    // naming: it is the one case where the answer stays zero on purpose.
    if (product.costPriceOre == null || product.costPriceOre === 0) unpriced.push(product.name);
    console.log(
      `${product.name}: ${n(changed.length, "rad", "rader")}, ${kr(was)} → ${kr(will)}`,
    );

    if (!write) continue;
    await prisma.$transaction(async (tx) => {
      for (const r of changed) {
        const want = settled.get(r.id)!;
        await tx.stockEntry.update({
          where: { id: r.id },
          data: {
            units: want.units,
            open80: want.open[80] ?? 0,
            open60: want.open[60] ?? 0,
            open40: want.open[40] ?? 0,
            open20: want.open[20] ?? 0,
            valueDeltaOre: want.valueDeltaOre,
          },
        });
      }
    });
  }

  console.log(
    touchedProducts === 0
      ? "\nInget att räkna om. Lagrets värde är redan det reglerna ger."
      : `\n${n(touchedRows, "rad", "rader")} på ${n(touchedProducts, "produkt", "produkter")}. ` +
        `Lagret: ${kr(before)} → ${kr(after)}.`,
  );
  if (unpriced.length > 0) {
    console.log(
      `\nUtan inköpspris, och därför fortfarande värda noll: ${unpriced.join(", ")}.` +
        "\nSätt priset på produkten och kör om.",
    );
  }
  if (touchedProducts > 0 && !write) console.log("\nInget skrivet. Kör om med --write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
