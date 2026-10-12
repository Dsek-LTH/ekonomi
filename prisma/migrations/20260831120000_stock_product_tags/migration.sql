-- Free labels on a product ("whisky", "cognac", "vodka"), for finding the
-- shelf's whiskies when the drink type says only "Spritdryck".
--
-- A list on the product rather than a table of its own: a tag exists by being
-- carried, so the picker offers what the products already hold and nothing has
-- to be kept in step with anything.
--
-- Defaults to the empty array, so every product that exists now carries no
-- tags rather than a null that every reader would have to answer for.
ALTER TABLE "StockProduct" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- GIN, like the User arrays: the question asked of this column is "which
-- products carry this tag", which is containment (`@>`, `&&`), and a btree
-- cannot serve either operator.
CREATE INDEX "StockProduct_tags_idx" ON "StockProduct" USING GIN ("tags");
