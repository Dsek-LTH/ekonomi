-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Existing documents keep the order they already had: upload order.
UPDATE "Receipt" AS r
SET "position" = o.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "expenseId" ORDER BY "createdAt", "id") - 1 AS rn
  FROM "Receipt"
) AS o
WHERE r."id" = o."id";
