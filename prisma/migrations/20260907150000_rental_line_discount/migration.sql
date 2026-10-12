-- A discount belongs to the line it comes off, not to the rental as a whole.
-- One figure for the lot could express the total but never the reason, and the
-- reason is what somebody reading the contract next year wants: these speakers
-- at half price because they went to another section, that mixer at full price
-- because it did not.
ALTER TABLE "RentalLine" ADD COLUMN "discountPercent" INTEGER NOT NULL DEFAULT 0;

-- Existing rentals carried one discount for the whole contract. Spread it over
-- the lines in proportion to what each line costs, so the totals the document
-- already printed still come out the same. Rentals with no discount, which is
-- nearly all of them, are untouched by this.
UPDATE "RentalLine" l
SET "discountPercent" = sub.pct
FROM (
  SELECT rl.id,
         ROUND(rd."discountOre"::numeric * 100 / NULLIF(rd."subtotalOre", 0))::int AS pct
  FROM "RentalLine" rl
  JOIN "RentalDetails" rd ON rd."contractId" = rl."contractId"
  WHERE rd."discountOre" > 0 AND rd."subtotalOre" > 0
) sub
WHERE sub.id = l.id;
