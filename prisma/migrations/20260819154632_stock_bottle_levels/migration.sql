-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "StockEntryKind" ADD VALUE 'CHECKOUT';
ALTER TYPE "StockEntryKind" ADD VALUE 'RETURN';
-- DropForeignKey
ALTER TABLE "StockReading" DROP CONSTRAINT "StockReading_entryId_fkey";
-- AlterTable
ALTER TABLE "StockEntry" DROP COLUMN "volumeMl",
ADD COLUMN     "open20" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "open40" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "open60" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "open80" INTEGER NOT NULL DEFAULT 0;
-- AlterTable
ALTER TABLE "StockProduct" DROP COLUMN "fullGrams",
DROP COLUMN "tareGrams",
DROP COLUMN "tareProvisional";
-- DropTable
DROP TABLE "StockReading";
-- DropEnum
DROP TYPE "StockReadingPhase";
