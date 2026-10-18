-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "resultUnitId" TEXT;

-- CreateIndex
CREATE INDEX "Card_resultUnitId_idx" ON "Card"("resultUnitId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_resultUnitId_fkey" FOREIGN KEY ("resultUnitId") REFERENCES "ResultUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
