-- Warning that stock may be near its best-before, without knowing any crate's.
--
-- Nothing is written on a crate in this cellar, crates get mixed on the shelf,
-- and they come off it in whatever order somebody reaches. So the app never
-- claims to know a real date. What it knows is how long a product keeps and
-- when a delivery arrived, and those two are enough to say "a delivery from
-- March is worth going and looking at before Christmas", which is the only
-- honest thing this data can say.
--
-- Three columns and a settings row:
--
--   StockProduct.shelfLifeMonths   how long the product keeps. A fact about the
--                                  product, in the unit the answer is known in.
--   StockEntry.bestBefore          worked out per delivery when it is written,
--                                  and captured, the way unitCostOre is. It is
--                                  also where a real date goes when somebody
--                                  has actually read the crate.
--   StockEntry.checkedAt           when somebody last looked and said it was
--                                  fine. What makes a warning clearable.
--
-- The lead time is section-wide policy rather than a property of any product,
-- so it lives on its own singleton beside BookkeepingSettings.
ALTER TABLE "StockProduct" ADD COLUMN "shelfLifeMonths" INTEGER;

ALTER TABLE "StockEntry" ADD COLUMN "bestBefore" DATE;
ALTER TABLE "StockEntry" ADD COLUMN "checkedAt" DATE;

-- The question asked of these is "which deliveries are due a look", which is a
-- range over the date, narrowed to the rows that have one.
CREATE INDEX "StockEntry_bestBefore_idx" ON "StockEntry"("bestBefore");

CREATE TABLE "StockSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "expiryLeadDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockSettings_pkey" PRIMARY KEY ("id")
);
