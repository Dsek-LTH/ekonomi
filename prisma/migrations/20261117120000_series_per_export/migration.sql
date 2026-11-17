-- Each kind of export names its own verifikationsserie (docs/settings.md). The
-- connection's series was the shared default; it is copied to every place that
-- fell back on it, so nothing exports into a different series than before, and
-- then it goes.

-- AlterTable
ALTER TABLE "BookkeepingSettings" ADD COLUMN "expenseVoucherSeries" TEXT;

INSERT INTO "BookkeepingSettings" ("id", "updatedAt")
SELECT 'singleton', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "FortnoxConnection" WHERE "voucherSeries" IS NOT NULL)
ON CONFLICT ("id") DO NOTHING;

UPDATE "BookkeepingSettings"
   SET "expenseVoucherSeries" = (SELECT "voucherSeries" FROM "FortnoxConnection" WHERE "voucherSeries" IS NOT NULL LIMIT 1),
       "incomeVoucherSeries" = COALESCE("incomeVoucherSeries", (SELECT "voucherSeries" FROM "FortnoxConnection" WHERE "voucherSeries" IS NOT NULL LIMIT 1))
 WHERE "id" = 'singleton';

UPDATE "Stock"
   SET "voucherSeries" = (SELECT "voucherSeries" FROM "FortnoxConnection" WHERE "voucherSeries" IS NOT NULL LIMIT 1)
 WHERE "voucherSeries" IS NULL;

-- AlterTable
ALTER TABLE "FortnoxConnection" DROP COLUMN "voucherSeries";
