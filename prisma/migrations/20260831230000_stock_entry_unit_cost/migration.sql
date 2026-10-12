-- What a unit cost when a row was written, captured on the row.
--
-- The value column used to be replayed from the product's *current* price, so
-- correcting a mistyped price silently re-priced every movement ever made
-- against that product, the next time anything touched it. A price is a fact
-- about the day stock arrived; it does not reach backwards.
ALTER TABLE "StockEntry" ADD COLUMN "unitCostOre" INTEGER;

-- Every existing row takes the price it was valued at, which is the product's
-- current one: that is what the replay has been using all along, so this
-- captures the status quo rather than restating it.
UPDATE "StockEntry" e
SET "unitCostOre" = p."costPriceOre"
FROM "StockProduct" p
WHERE p.id = e."productId" AND p."costPriceOre" IS NOT NULL;
