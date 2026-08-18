-- CreateEnum
CREATE TYPE "StockKind" AS ENUM ('UNIT', 'VOLUME');

-- CreateEnum
CREATE TYPE "DrinkCategory" AS ENUM ('SPRITDRYCK', 'VIN', 'ANDRA_JASTA', 'STARKOL', 'ALKOHOLDRYCKSLIKNANDE', 'FOLKOL', 'LATTDRYCK', 'OVRIGT');

-- CreateEnum
CREATE TYPE "StockEntryKind" AS ENUM ('PURCHASE', 'SERVING', 'WASTE', 'COUNT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "StockReadingPhase" AS ENUM ('OUT', 'BACK', 'COUNT');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STOCKARE';

-- CreateTable
CREATE TABLE "StockProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StockKind" NOT NULL,
    "category" "DrinkCategory" NOT NULL,
    "abv" DECIMAL(5,2),
    "unitMl" INTEGER,
    "nominalMl" INTEGER,
    "tareGrams" INTEGER,
    "fullGrams" INTEGER,
    "normalPriceOre" INTEGER,
    "minimumLevel" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "bestBefore" DATE,
    "receivedAt" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockEntry" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT,
    "kind" "StockEntryKind" NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "volumeMl" INTEGER NOT NULL DEFAULT 0,
    "openBottles" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" DATE NOT NULL,
    "actorId" TEXT NOT NULL,
    "expenseId" TEXT,
    "correctsId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReading" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "grams" INTEGER NOT NULL,
    "phase" "StockReadingPhase" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockProduct_active_category_idx" ON "StockProduct"("active", "category");

-- CreateIndex
CREATE INDEX "StockLot_productId_bestBefore_idx" ON "StockLot"("productId", "bestBefore");

-- CreateIndex
CREATE INDEX "StockEntry_productId_occurredAt_idx" ON "StockEntry"("productId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockEntry_occurredAt_idx" ON "StockEntry"("occurredAt");

-- CreateIndex
CREATE INDEX "StockEntry_kind_occurredAt_idx" ON "StockEntry"("kind", "occurredAt");

-- CreateIndex
CREATE INDEX "StockReading_entryId_idx" ON "StockReading"("entryId");

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StockProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StockProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "StockEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReading" ADD CONSTRAINT "StockReading_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StockEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
