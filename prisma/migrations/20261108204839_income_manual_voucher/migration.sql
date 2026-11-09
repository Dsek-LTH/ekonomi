-- A kontering written by hand for a day of income, and the fingerprint of the
-- lines it was written against. See IncomeReport.manualVoucher.
-- AlterTable
ALTER TABLE "IncomeReport" ADD COLUMN     "manualVoucher" JSONB,
ADD COLUMN     "manualVoucherAt" TIMESTAMP(3),
ADD COLUMN     "manualVoucherBasis" TEXT,
ADD COLUMN     "manualVoucherById" TEXT;

-- AddForeignKey
ALTER TABLE "IncomeReport" ADD CONSTRAINT "IncomeReport_manualVoucherById_fkey" FOREIGN KEY ("manualVoucherById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
