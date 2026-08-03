-- CreateEnum
CREATE TYPE "CostCenterSource" AS ENUM ('FORTNOX', 'LOCAL');

-- AlterTable
ALTER TABLE "CostCenter" ADD COLUMN     "source" "CostCenterSource" NOT NULL DEFAULT 'FORTNOX';
