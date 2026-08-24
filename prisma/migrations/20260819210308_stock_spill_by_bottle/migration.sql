-- Spill counted in things rather than millilitres.
--
-- `spilledQty` used to hold the product's own unit: cans for a can, millilitres
-- for a spirit. That meant nobody could record "we dropped one" — they had to
-- work out what was in the bottle first, and the stored figure could not be
-- read back as the thing that happened. It now holds a count, and the rung the
-- bottles came off sits beside it: a dropped bottle loses everything left in
-- it, so the rung is the whole of what it cost.
ALTER TABLE "StockEntry" ADD COLUMN "spilledLevel" INTEGER;

-- Rows written under the old meaning. A can's figure was already a count and is
-- left alone; a spirit's was millilitres, so it is turned back into whole
-- bottles at the nominal size and left at no rung, which reads as "whole
-- bottles". That is the closest true statement available: the old rows never
-- recorded which rung was dropped.
UPDATE "StockEntry" AS e
SET "spilledQty" = GREATEST(1, ROUND(e."spilledQty"::numeric / p."nominalMl"))
FROM "StockProduct" AS p
WHERE e."productId" = p."id"
  AND e."kind" = 'WASTE'
  AND e."spilledQty" <> 0
  AND p."kind" = 'VOLUME'
  AND p."nominalMl" IS NOT NULL
  AND p."nominalMl" > 0;
