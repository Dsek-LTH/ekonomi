-- One income voucher per day and source, with the verksamhet and cost centre
-- on each sold line instead of on the report.
--
-- Unbooked reports are dropped: they are a working set, and the next fetch
-- brings the same days back in the new shape. Booked and exported reports are
-- left exactly as they are (one verksamhet's day, or a day of Zettle fees) and
-- are only ever read from here on.
DELETE FROM "IncomeReport" WHERE "status" = 'DRAFT';

-- CreateEnum
CREATE TYPE "IncomeLineKind" AS ENUM ('SALE', 'FEE');

-- AlterTable
ALTER TABLE "IncomeLine" ADD COLUMN     "costCenterId" TEXT,
ADD COLUMN     "kind" "IncomeLineKind" NOT NULL DEFAULT 'SALE',
ADD COLUMN     "resultUnitId" TEXT,
ADD COLUMN     "unmatched" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "IncomeProductPrefix" ADD COLUMN     "costCenterId" TEXT;

-- CreateIndex
CREATE INDEX "IncomeLine_resultUnitId_idx" ON "IncomeLine"("resultUnitId");

-- AddForeignKey
ALTER TABLE "IncomeProductPrefix" ADD CONSTRAINT "IncomeProductPrefix_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeLine" ADD CONSTRAINT "IncomeLine_resultUnitId_fkey" FOREIGN KEY ("resultUnitId") REFERENCES "ResultUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeLine" ADD CONSTRAINT "IncomeLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A source's day is booked once. The old index covers reports that name a
-- verksamhet; on the new reports that column is null, and Postgres treats
-- nulls as distinct, so they get one of their own.
CREATE UNIQUE INDEX "IncomeReport_day_booked_once"
  ON "IncomeReport" ("source", "date")
  WHERE "status" IN ('BOOKED', 'EXPORTED') AND "resultUnitId" IS NULL AND "source" <> 'ZETTLE_FEE';
