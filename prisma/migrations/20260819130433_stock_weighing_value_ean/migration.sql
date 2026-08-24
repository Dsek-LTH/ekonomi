/*
  Warnings:

  - You are about to drop the column `openBottles` on the `StockEntry` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StockEntry" DROP COLUMN "openBottles",
ADD COLUMN     "valueDeltaOre" INTEGER NOT NULL DEFAULT 0;
