-- AlterTable
ALTER TABLE "RentalDetails" ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "checkedById" TEXT,
ADD COLUMN     "conditionIn" TEXT,
ADD COLUMN     "conditionOut" TEXT;

-- AlterTable
ALTER TABLE "RentalItem" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE "RentalDetails" ADD CONSTRAINT "RentalDetails_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
