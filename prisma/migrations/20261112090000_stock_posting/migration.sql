-- Posting a stock's value to Fortnox (docs/stock.md): what was sent, per day,
-- reason and product type, so every later voucher can be "what the log says
-- now, less what was already sent".

-- CreateEnum
CREATE TYPE "StockVoucherKind" AS ENUM ('DAILY', 'CORRECTION', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "StockPostingClass" AS ENUM ('PURCHASE', 'CONSUMPTION', 'BOARD', 'LOSS', 'COUNT');

-- AlterTable
ALTER TABLE "Verification" ADD COLUMN     "stockVoucherId" TEXT;

-- CreateTable
CREATE TABLE "StockVoucher" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "StockVoucherKind" NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "valueAfterOre" INTEGER NOT NULL,
    "exportClaimedById" TEXT,
    "exportClaimedAt" TIMESTAMP(3),
    "exportClaimState" "ExportClaimState",
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPostingLine" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "class" "StockPostingClass" NOT NULL,
    "groupId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "amountOre" INTEGER NOT NULL,

    CONSTRAINT "StockPostingLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockVoucher_stockId_kind_date_idx" ON "StockVoucher"("stockId", "kind", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StockVoucher_stockId_date_kind_sequence_key" ON "StockVoucher"("stockId", "date", "kind", "sequence");

-- CreateIndex
CREATE INDEX "StockPostingLine_voucherId_idx" ON "StockPostingLine"("voucherId");

-- CreateIndex
CREATE INDEX "StockPostingLine_forDate_idx" ON "StockPostingLine"("forDate");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_stockVoucherId_key" ON "Verification"("stockVoucherId");

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_stockVoucherId_fkey" FOREIGN KEY ("stockVoucherId") REFERENCES "StockVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockVoucher" ADD CONSTRAINT "StockVoucher_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockVoucher" ADD CONSTRAINT "StockVoucher_exportClaimedById_fkey" FOREIGN KEY ("exportClaimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockVoucher" ADD CONSTRAINT "StockVoucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPostingLine" ADD CONSTRAINT "StockPostingLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "StockVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPostingLine" ADD CONSTRAINT "StockPostingLine_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StockGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPostingLine" ADD CONSTRAINT "StockPostingLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A voucher now hangs off exactly one of three things. Prisma cannot say it.
ALTER TABLE "Verification" DROP CONSTRAINT "Verification_exactly_one_subject";
ALTER TABLE "Verification"
  ADD CONSTRAINT "Verification_exactly_one_subject"
  CHECK (num_nonnulls("expenseId", "incomeReportId", "stockVoucherId") = 1);
