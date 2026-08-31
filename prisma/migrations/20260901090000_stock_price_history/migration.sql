-- Two records that did not exist: what a correction did to a booked price, and
-- what anybody has ever done to a product.
--
-- A delivery captures what a unit cost when it was written and nothing may move
-- it afterwards, because a price is a fact about the day stock arrived. The one
-- exception is the price having been wrong from the start; correcting that
-- re-values every movement of the product after it, so it is recorded here
-- rather than done quietly.
ALTER TABLE "StockChange" ADD COLUMN "fromUnitCostOre" INTEGER;
ALTER TABLE "StockChange" ADD COLUMN "toUnitCostOre" INTEGER;

-- And the product itself. Until now a cost price could be corrected by anyone
-- with stock rights and the only trace was that figures started coming out
-- differently afterwards.
CREATE TABLE "StockProductChange" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "StockProductChange_pkey" PRIMARY KEY ("id")
);

-- "Everything that has been done to this product, newest first", which is the
-- only way it is ever read.
CREATE INDEX "StockProductChange_productId_at_idx" ON "StockProductChange"("productId", "at");

ALTER TABLE "StockProductChange" ADD CONSTRAINT "StockProductChange_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "StockProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The actor is kept: a log that loses who did something is half a log, so a
-- user who has ever changed a product cannot be deleted out from under it.
ALTER TABLE "StockProductChange" ADD CONSTRAINT "StockProductChange_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
