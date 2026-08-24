-- A product is stocked or it does not exist.
--
-- `active` was a second state for a product the bar had stopped ordering: kept
-- out of the pickers, kept in the log, and given a tab of its own on the list.
-- It never earned that. The guild does not retire products — it stocks them, or
-- it never made them — and a two-state list meant every picker, every scan and
-- every check on the event sheet had to remember which state it was looking at.
--
-- What it was really protecting is the log: a product with movements against it
-- cannot be deleted, because the movements outlive the shelf. That protection
-- stays, as a refusal rather than a hidden state — see DELETE
-- /api/stock/products/[id], which now says so instead of quietly retiring.
DROP INDEX "StockProduct_active_category_idx";
ALTER TABLE "StockProduct" DROP COLUMN "active";
CREATE INDEX "StockProduct_category_idx" ON "StockProduct"("category");
