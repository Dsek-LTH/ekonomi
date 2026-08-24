import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { cellTotals, cellKey, type CellKind, type CellRow } from "@/lib/stock/cells";
import { tagTotals } from "@/lib/stock/tag";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const tag = await prisma.stockTag.findFirst({ orderBy: { createdAt: "desc" } });
  if (!tag) return void console.log("no tag");
  console.log("tag:", tag.name);
  const entries = await prisma.stockEntry.findMany({
    where: { tagId: tag.id },
    select: { kind: true, level: true, units: true, open80: true, open60: true,
      open40: true, open20: true, spilledQty: true,
      product: { select: { id: true, name: true, kind: true, nominalMl: true } } },
  });
  console.log("raw rows:");
  for (const e of entries) {
    console.log("  " + e.product.name.padEnd(16) + " " + e.kind.padEnd(9) +
      " lvl=" + String(e.level).padEnd(3) + " u=" + String(e.units).padEnd(5) +
      " o=" + [e.open80, e.open60, e.open40, e.open20].join("/") + " sp=" + e.spilledQty);
  }
  const cells = cellTotals(entries.map((e): CellRow => ({
    productId: e.product.id, kind: e.kind as CellKind, level: e.level, units: e.units,
    open: { 80: e.open80, 60: e.open60, 40: e.open40, 20: e.open20 }, spilledQty: e.spilledQty,
  })));
  const byProduct = new Map<string, typeof entries>();
  for (const e of entries) byProduct.set(e.product.id, [...(byProduct.get(e.product.id) ?? []), e]);
  console.log("what the sheet receives:");
  for (const [pid, rows] of byProduct) {
    const p = rows[0].product;
    const mine: Record<string, number> = {};
    for (const [key, value] of cells) {
      if (value !== 0 && key.startsWith(pid + "|")) mine[key.slice(pid.length + 1)] = value;
    }
    const totals = tagTotals(p, rows.map((r) => ({ kind: r.kind, units: r.units,
      open: { 80: r.open80, 60: r.open60, 40: r.open40, 20: r.open20 },
      spilledQty: r.spilledQty, level: r.level })));
    console.log("  " + p.name + ": cells=" + JSON.stringify(mine) + " totals=" + JSON.stringify(totals));
    const lookups = (p.kind === "VOLUME" ? [0, 80, 60, 40, 20] : [0]).flatMap((level) =>
      (["CHECKOUT", "RETURN", "WASTE"] as CellKind[]).map((kind) => {
        const suffix = cellKey({ productId: pid, kind, level }).slice(pid.length + 1);
        return suffix + "=" + (mine[suffix] ?? 0);
      }),
    );
    console.log("    client reads: " + lookups.join("  "));
  }
  await prisma.$disconnect();
}
void main();
