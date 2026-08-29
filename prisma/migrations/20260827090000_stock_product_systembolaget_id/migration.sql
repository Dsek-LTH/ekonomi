-- Systembolaget's article number for a product — the digits at the end of its
-- URL. Text, not an integer: an identifier like the barcode beside it, and a
-- leading zero would not survive a numeric column.
ALTER TABLE "StockProduct" ADD COLUMN "systembolagetId" TEXT;
