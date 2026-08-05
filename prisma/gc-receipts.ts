// Reconciles the receipt bucket against the database: the only objects that
// belong in storage are the ones some Receipt row points at.
//
// The delete routes remove the object before the row and refuse to drop the
// row if that fails, so a live server does not create orphans and on a healthy
// system this finds nothing. It exists for what the request path cannot cover:
// an upload whose rollback could not reach storage, and rows deleted straight
// from the database or Studio, where the Expense→Receipt cascade runs somewhere
// storage cannot see it.
//
//   pnpm receipts:gc            # report what is orphaned, change nothing
//   pnpm receipts:gc --delete   # actually remove it
//
// Reporting is the default because this deletes verifikat when it is wrong, and
// the cheap way to find out that it is wrong is to read the list first.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/lib/generated/prisma/client";
import { bucket, deleteKeys, listObjects } from "./storage-admin";
import { expenseLabel } from "../src/lib/domain/reference";

// Standalone run — load .env ourselves, as seed.ts does.
import { loadEnvFile } from "./load-env";

loadEnvFile();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// An upload writes its bytes before its row, so for a moment a perfectly good
// object has nothing pointing at it. Anything younger than this is assumed to
// be an upload in flight rather than an orphan.
const GRACE_MS = 60 * 60 * 1000; // 1 hour

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Receipts an utlägg has stopped using. One utlägg has one receipt — the newest
// — so anything behind it is a receipt that was replaced before the upload
// route learned to clear up after itself, and no page in the app can reach it.
// These have rows, so the orphan pass below cannot see them; they need finding
// by shape instead. New ones cannot appear, but the old ones are still here.
async function supersededReceipts() {
  const grouped = await prisma.expense.findMany({
    where: { receipts: { some: {} } },
    select: {
      id: true,
      reference: true,
      receipts: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], // same order the app reads
        select: { id: true, filename: true, objectKey: true, thumbnailKey: true },
      },
    },
  });
  return grouped.flatMap((e) =>
    e.receipts.slice(1).map((r) => ({ ...r, expense: expenseLabel(e) })),
  );
}

async function main() {
  const shouldDelete = process.argv.includes("--delete");

  const superseded = await supersededReceipts();

  const rows = await prisma.receipt.findMany({
    select: { id: true, objectKey: true, thumbnailKey: true },
  });
  const referenced = new Set<string>();
  for (const r of rows) {
    referenced.add(r.objectKey);
    if (r.thumbnailKey) referenced.add(r.thumbnailKey);
  }

  const objects = await listObjects();
  const present = new Set(objects.map((o) => o.key));
  const now = Date.now();

  const unreferenced = objects.filter((o) => !referenced.has(o.key));
  const orphans = unreferenced.filter((o) => now - o.lastModified.getTime() >= GRACE_MS);
  const recent = unreferenced.length - orphans.length;

  // The opposite failure, which this script cannot repair but should not stay
  // quiet about: a row whose bytes are gone is a verifikat nobody can produce.
  const missing = rows.filter(
    (r) => !present.has(r.objectKey) || (r.thumbnailKey && !present.has(r.thumbnailKey)),
  );

  console.log(
    `Bucket ${bucket()}: ${objects.length} objekt, ${referenced.size} refererade av ${rows.length} kvitton.`,
  );

  if (missing.length > 0) {
    console.warn(`\n⚠  ${missing.length} kvitto(n) saknar sin fil i storage:`);
    for (const r of missing) console.warn(`   receipt ${r.id} → ${r.objectKey}`);
  }

  if (recent > 0) {
    console.log(`\n${recent} orefererade objekt yngre än 1 h — hoppas över (pågående uppladdning?).`);
  }

  const sizeOf = (key: string) => objects.find((o) => o.key === key)?.size ?? 0;

  if (superseded.length > 0) {
    const bytes = superseded.reduce(
      (sum, r) => sum + sizeOf(r.objectKey) + (r.thumbnailKey ? sizeOf(r.thumbnailKey) : 0),
      0,
    );
    console.log(`\n${superseded.length} ersatta kvitton som inget utlägg visar (${mb(bytes)}):`);
    for (const r of superseded) console.log(`   ${r.expense}: ${r.filename}  (${r.id})`);

    if (shouldDelete) {
      // Files before rows, as everywhere else: a row kept beside a deleted file
      // is recoverable, the reverse is invisible.
      const keys = superseded.flatMap((r) =>
        [r.objectKey, r.thumbnailKey].filter((k): k is string => Boolean(k)),
      );
      const failures = await deleteKeys(keys);
      for (const f of failures) console.error(`   kunde inte ta bort ${f.key}: ${f.message}`);
      const stuck = new Set(failures.map((f) => f.key));
      const clear = superseded.filter(
        (r) => !stuck.has(r.objectKey) && !(r.thumbnailKey && stuck.has(r.thumbnailKey)),
      );
      await prisma.receipt.deleteMany({ where: { id: { in: clear.map((r) => r.id) } } });
      console.log(`Tog bort ${clear.length} ersatta kvitton (${mb(bytes)}).`);
    }
  }

  if (orphans.length > 0) {
    const total = orphans.reduce((sum, o) => sum + o.size, 0);
    console.log(`\n${orphans.length} föräldralösa objekt (${mb(total)}):`);
    for (const o of orphans) console.log(`   ${o.key}  (${mb(o.size)})`);

    if (shouldDelete) {
      const failures = await deleteKeys(orphans.map((o) => o.key));
      for (const f of failures) console.error(`   kunde inte ta bort ${f.key}: ${f.message}`);
      console.log(`Tog bort ${orphans.length - failures.length} objekt (${mb(total)}).`);
    }
  }

  if (orphans.length === 0 && superseded.length === 0) {
    console.log("\nInget att rensa.");
  } else if (!shouldDelete) {
    console.log("\nTorrkörning. Kör med --delete för att ta bort det ovanstående.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
