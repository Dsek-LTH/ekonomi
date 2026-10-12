-- CreateEnum
CREATE TYPE "ExportClaimState" AS ENUM ('CLAIMED', 'SENT', 'UNCERTAIN');

-- AlterEnum
ALTER TYPE "ExpenseEventType" ADD VALUE 'EXPORT_RELEASED';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "exportClaimState" "ExportClaimState",
ADD COLUMN     "exportClaimedAt" TIMESTAMP(3),
ADD COLUMN     "exportClaimedById" TEXT;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_exportClaimedById_fkey" FOREIGN KEY ("exportClaimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
