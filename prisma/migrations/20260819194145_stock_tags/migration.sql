-- AlterTable
ALTER TABLE "StockEntry" DROP COLUMN "outstanding",
ADD COLUMN     "spilledQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tagId" TEXT;
-- CreateTable
CREATE TABLE "StockTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    CONSTRAINT "StockTag_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "StockTag_date_name_idx" ON "StockTag"("date", "name");
-- CreateIndex
CREATE INDEX "StockEntry_tagId_idx" ON "StockEntry"("tagId");
-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "StockTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "StockTag" ADD CONSTRAINT "StockTag_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
