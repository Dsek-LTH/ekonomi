-- CreateEnum
CREATE TYPE "IncomeSource" AS ENUM ('ZETTLE', 'ZETTLE_FEE', 'SWISH');

-- CreateEnum
CREATE TYPE "IncomeReportStatus" AS ENUM ('DRAFT', 'EXCLUDED', 'BOOKED', 'EXPORTED');

-- AlterTable
ALTER TABLE "BookkeepingSettings" ADD COLUMN     "swishClearingAccount" TEXT NOT NULL DEFAULT '1931',
ADD COLUMN     "zettleClearingAccount" TEXT NOT NULL DEFAULT '1930',
ADD COLUMN     "zettleFeeAccount" TEXT NOT NULL DEFAULT '6570',
ADD COLUMN     "zettleFeeCostCenterId" TEXT;

-- AlterTable
ALTER TABLE "Verification" ADD COLUMN     "incomeReportId" TEXT,
ALTER COLUMN "expenseId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "IncomeCommittee" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "properName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultCostCenterId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeCommittee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeProductPrefix" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeProductPrefix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwishAmountFallback" (
    "amount" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwishAmountFallback_pkey" PRIMARY KEY ("amount")
);

-- CreateTable
CREATE TABLE "IncomeBatch" (
    "id" TEXT NOT NULL,
    "source" "IncomeSource" NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "filename" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeReport" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "source" "IncomeSource" NOT NULL,
    "committeeId" TEXT,
    "date" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "status" "IncomeReportStatus" NOT NULL DEFAULT 'DRAFT',
    "costCenterId" TEXT,
    "documentKey" TEXT,
    "documentFilename" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeLine" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variant" TEXT,
    "account" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IncomeLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomeCommittee_key_key" ON "IncomeCommittee"("key");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeProductPrefix_code_key" ON "IncomeProductPrefix"("code");

-- CreateIndex
CREATE INDEX "IncomeProductPrefix_committeeId_idx" ON "IncomeProductPrefix"("committeeId");

-- CreateIndex
CREATE INDEX "IncomeBatch_createdAt_id_idx" ON "IncomeBatch"("createdAt", "id");

-- CreateIndex
CREATE INDEX "IncomeBatch_source_createdAt_id_idx" ON "IncomeBatch"("source", "createdAt", "id");

-- CreateIndex
CREATE INDEX "IncomeReport_source_committeeId_date_idx" ON "IncomeReport"("source", "committeeId", "date");

-- CreateIndex
CREATE INDEX "IncomeReport_batchId_idx" ON "IncomeReport"("batchId");

-- CreateIndex
CREATE INDEX "IncomeReport_status_date_id_idx" ON "IncomeReport"("status", "date", "id");

-- CreateIndex
CREATE INDEX "IncomeLine_reportId_idx" ON "IncomeLine"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_incomeReportId_key" ON "Verification"("incomeReportId");

-- AddForeignKey
ALTER TABLE "BookkeepingSettings" ADD CONSTRAINT "BookkeepingSettings_zettleFeeCostCenterId_fkey" FOREIGN KEY ("zettleFeeCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeCommittee" ADD CONSTRAINT "IncomeCommittee_defaultCostCenterId_fkey" FOREIGN KEY ("defaultCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeProductPrefix" ADD CONSTRAINT "IncomeProductPrefix_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "IncomeCommittee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_incomeReportId_fkey" FOREIGN KEY ("incomeReportId") REFERENCES "IncomeReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeBatch" ADD CONSTRAINT "IncomeBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeReport" ADD CONSTRAINT "IncomeReport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IncomeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeReport" ADD CONSTRAINT "IncomeReport_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "IncomeCommittee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeReport" ADD CONSTRAINT "IncomeReport_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeLine" ADD CONSTRAINT "IncomeLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "IncomeReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Constraints Prisma cannot express ────────────────────────────────

-- A verifikation belongs to exactly one thing: an expense (money out) or an
-- income report (money in). Prisma can only say that each column is nullable
-- and separately unique, which permits a row with neither, an orphaned
-- voucher that no screen would ever show and no export would ever pick up,
-- as readily as one with both.
ALTER TABLE "Verification"
  ADD CONSTRAINT "Verification_exactly_one_subject"
  CHECK (num_nonnulls("expenseId", "incomeReportId") = 1);

-- The same takings must not be booked twice. A report is identified by its
-- source, its committee and its day; importing the same range again is normal
-- and has to stay possible, so the uniqueness applies only once a report has
-- actually been booked.
--
-- A partial unique index, because a plain one would forbid the re-import. The
-- old CLI had no equivalent at all: running `upload` twice wrote every voucher
-- again, and nothing noticed.
CREATE UNIQUE INDEX "IncomeReport_booked_once"
  ON "IncomeReport" ("source", "committeeId", "date")
  WHERE "status" IN ('BOOKED', 'EXPORTED');

-- Exactly one prefix is the fallback for products matching nothing. Without
-- one an unrecognised product has nowhere to go; with two the routing would
-- depend on which row was read first.
CREATE UNIQUE INDEX "IncomeProductPrefix_single_fallback"
  ON "IncomeProductPrefix" (("isFallback"))
  WHERE "isFallback";
