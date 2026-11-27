-- A pack size was asked for on every product so deliveries and refills could be typed in packs. Nothing is typed in
-- packs, and the section said it never will be, so the column goes.
ALTER TABLE "StockProduct" DROP COLUMN "packSize";
