-- Drop StockLot, which nothing ever wrote to.
--
-- The table was added for per-delivery best-before tracking and superseded by
-- StockEntry."bestBefore", which the delivery route has computed from the
-- product's shelf life since 20260902140000_stock_best_before. No code path
-- ever created a lot, so "StockEntry"."lotId" is null on every row and the
-- table is empty; both drops are therefore data-free.
ALTER TABLE "StockEntry" DROP CONSTRAINT IF EXISTS "StockEntry_lotId_fkey";
ALTER TABLE "StockEntry" DROP COLUMN "lotId";
DROP TABLE "StockLot";
