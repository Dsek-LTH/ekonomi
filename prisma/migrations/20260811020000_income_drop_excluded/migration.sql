-- Drop EXCLUDED from IncomeReportStatus.
--
-- A day deliberately skipped was a state left over from the manifest file the
-- review screen replaced. Nothing needs it: an unbooked day is unbooked, and
-- the next fetch clears the working set anyway.
--
-- Any day currently sitting in it becomes a draft again — it is exactly what it
-- was before someone pressed skip, and the alternative (deleting it) would
-- throw away takings that were only ever set aside.
UPDATE "IncomeReport" SET "status" = 'DRAFT' WHERE "status" = 'EXCLUDED';

-- Postgres cannot remove a value from an enum, so the type is rebuilt. The two
-- indexes over `status` go first: the partial one names the enum's values in
-- its predicate, so it cannot survive the column being retyped underneath it.
DROP INDEX "IncomeReport_booked_once";
DROP INDEX "IncomeReport_status_date_id_idx";

ALTER TYPE "IncomeReportStatus" RENAME TO "IncomeReportStatus_old";
CREATE TYPE "IncomeReportStatus" AS ENUM ('DRAFT', 'BOOKED', 'EXPORTED');

ALTER TABLE "IncomeReport" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "IncomeReport"
  ALTER COLUMN "status" TYPE "IncomeReportStatus"
  USING ("status"::text::"IncomeReportStatus");
ALTER TABLE "IncomeReport" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "IncomeReportStatus_old";

-- Rebuilt exactly as they were, against the new type. The unique one is still
-- what stops the same takings being booked twice.
CREATE UNIQUE INDEX "IncomeReport_booked_once"
  ON "IncomeReport" ("source", "resultUnitId", "date")
  WHERE "status" IN ('BOOKED', 'EXPORTED');
CREATE INDEX "IncomeReport_status_date_id_idx" ON "IncomeReport" ("status", "date", "id");
