-- DropForeignKey
ALTER TABLE "BudgetCostCenter" DROP CONSTRAINT "BudgetCostCenter_costCenterId_fkey";

-- AlterTable
ALTER TABLE "BudgetCostCenter" ADD COLUMN     "label" TEXT,
ALTER COLUMN "costCenterId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "BudgetRevision" ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedById" TEXT;

-- AddForeignKey
ALTER TABLE "BudgetRevision" ADD CONSTRAINT "BudgetRevision_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetCostCenter" ADD CONSTRAINT "BudgetCostCenter_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
