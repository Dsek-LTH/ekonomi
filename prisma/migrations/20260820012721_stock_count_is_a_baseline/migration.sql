-- A stocktake states what is there, rather than by how much the books were out.
--
-- It was stored only as the difference — counted minus whatever the books said
-- at that moment — which meant it stopped being true the instant anything
-- before it was corrected. Books say 100, you count 90, the row holds −10; fix
-- an earlier delivery down by 80 and the shelf reads 10 for a product somebody
-- physically counted at 90. Keeping the counted figure lets the difference be
-- worked out again on every change, so the count holds and everything before it
-- genuinely stops mattering. See lib/stock/replay.ts.
ALTER TABLE "StockEntry" ADD COLUMN "countedQty" INTEGER;

-- Existing counts, given back what they were counting: whatever the shelf came
-- to once they had been applied. Only the ones that moved whole things — a
-- count that adjusted several rungs at once belongs to no single rung, so it
-- keeps the difference it was written with and is left alone.
UPDATE "StockEntry" c
SET "countedQty" = COALESCE((
  SELECT SUM(e."units")
  FROM "StockEntry" e
  WHERE e."productId" = c."productId"
    AND (e."occurredAt" < c."occurredAt"
      OR (e."occurredAt" = c."occurredAt" AND e."createdAt" <= c."createdAt"))
), 0)
WHERE c."kind" = 'COUNT'
  AND c."level" = 0
  AND c."open80" = 0 AND c."open60" = 0 AND c."open40" = 0 AND c."open20" = 0;
