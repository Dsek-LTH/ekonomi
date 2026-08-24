-- A cell becomes a row, and edits become traceable.
--
-- Until now a night's Ut figure for a product was whatever a sum over some rows
-- came to, and correcting it meant writing another row. That is why the log
-- filled with movements nobody made: a delivery mistyped as 200 bottles stayed
-- on the books forever, with a second row cancelling it. From here a row *is*
-- the figure — one per occasion, product, direction and rung — and putting it
-- right means changing it. What was done to it is recorded in StockChange,
-- which is what keeps an editable ledger checkable.

CREATE TYPE "StockChangeAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- ── The rung, as a column ──
--
-- It says nothing the quantity columns do not already imply; it is here so the
-- unique index below can enforce what the sheet means.
ALTER TABLE "StockEntry" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 0;

-- Backfill from where the rung used to be implied: the open column that moved,
-- or, for a spill, its own column. A row touching several rungs at once keeps
-- level 0 and is left as the multi-rung row it is — only tagged rows are made
-- unique below, and the merge that follows leaves such rows alone.
UPDATE "StockEntry" SET "level" = 80 WHERE "open80" <> 0 AND "open60" = 0 AND "open40" = 0 AND "open20" = 0 AND "units" = 0;
UPDATE "StockEntry" SET "level" = 60 WHERE "open60" <> 0 AND "open80" = 0 AND "open40" = 0 AND "open20" = 0 AND "units" = 0;
UPDATE "StockEntry" SET "level" = 40 WHERE "open40" <> 0 AND "open80" = 0 AND "open60" = 0 AND "open20" = 0 AND "units" = 0;
UPDATE "StockEntry" SET "level" = 20 WHERE "open20" <> 0 AND "open80" = 0 AND "open60" = 0 AND "open40" = 0 AND "units" = 0;
UPDATE "StockEntry" SET "level" = "spilledLevel" WHERE "kind" = 'WASTE' AND "spilledLevel" IS NOT NULL;

ALTER TABLE "StockEntry" DROP COLUMN "spilledLevel";

-- ── Fold the old deltas into cells ──
--
-- Rows written under the old model — a checkout and the row correcting it, a
-- spill entered and taken back — are several rows where the new shape allows
-- one. They are summed into the oldest of each group, which is the same figure
-- read a different way: the sum was always what the screen showed.
WITH grouped AS (
  SELECT
    (array_agg("id" ORDER BY "createdAt", "id"))[1] AS keep,
    "tagId", "productId", "kind", "level",
    SUM("units")         AS units,
    SUM("open80")        AS open80,
    SUM("open60")        AS open60,
    SUM("open40")        AS open40,
    SUM("open20")        AS open20,
    SUM("spilledQty")    AS "spilledQty",
    SUM("valueDeltaOre") AS "valueDeltaOre"
  FROM "StockEntry"
  WHERE "tagId" IS NOT NULL
  GROUP BY "tagId", "productId", "kind", "level"
  HAVING COUNT(*) > 1
)
UPDATE "StockEntry" e
SET "units" = g.units, "open80" = g.open80, "open60" = g.open60,
    "open40" = g.open40, "open20" = g.open20,
    "spilledQty" = g."spilledQty", "valueDeltaOre" = g."valueDeltaOre"
FROM grouped g
WHERE e."id" = g.keep;

-- Everything the fold above swallowed.
DELETE FROM "StockEntry" e
USING (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "tagId", "productId", "kind", "level"
           ORDER BY "createdAt", "id"
         ) AS n
  FROM "StockEntry"
  WHERE "tagId" IS NOT NULL
) d
WHERE e."id" = d."id" AND d.n > 1;

-- A cell that nets to nothing is not a movement. Under the old model it was two
-- rows saying "this happened" and "no it did not"; under the new one it is the
-- absence of a row, which is what it always meant.
DELETE FROM "StockEntry"
WHERE "tagId" IS NOT NULL
  AND "units" = 0 AND "open80" = 0 AND "open60" = 0 AND "open40" = 0 AND "open20" = 0
  AND "spilledQty" = 0;

-- Nothing corrects anything any more: a correction is an edit now, and the old
-- links point at rows the fold above has removed.
UPDATE "StockEntry" SET "correctsId" = NULL
WHERE "correctsId" IS NOT NULL
  AND "correctsId" NOT IN (SELECT "id" FROM "StockEntry");

CREATE UNIQUE INDEX "StockEntry_tagId_productId_kind_level_key" ON "StockEntry"("tagId", "productId", "kind", "level");

-- ── Who did what ──
CREATE TABLE "StockChange" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tagId" TEXT,
    "action" "StockChangeAction" NOT NULL,
    "kind" "StockEntryKind" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "fromQty" INTEGER,
    "toQty" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "StockChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockChange_tagId_at_idx" ON "StockChange"("tagId", "at");
CREATE INDEX "StockChange_productId_at_idx" ON "StockChange"("productId", "at");
CREATE INDEX "StockChange_entryId_idx" ON "StockChange"("entryId");

ALTER TABLE "StockChange" ADD CONSTRAINT "StockChange_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StockProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockChange" ADD CONSTRAINT "StockChange_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "StockTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockChange" ADD CONSTRAINT "StockChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
