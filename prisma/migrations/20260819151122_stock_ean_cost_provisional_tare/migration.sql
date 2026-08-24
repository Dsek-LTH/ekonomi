-- AlterTable
ALTER TABLE "StockProduct" ADD COLUMN     "costPriceOre" INTEGER,
ADD COLUMN     "ean" TEXT,
ADD COLUMN     "tareProvisional" BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE "StockReading" ADD COLUMN     "bottles" INTEGER NOT NULL DEFAULT 1;
-- CreateIndex
CREATE UNIQUE INDEX "StockProduct_ean_key" ON "StockProduct"("ean");
