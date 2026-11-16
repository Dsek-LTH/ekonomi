-- Places in a stock: where stock is carried to and charged to (docs/stock.md, section 11).
-- Logging a move is granted per place by Authentik group, so the café's refill capability goes.

DELETE FROM "RoleCapability" WHERE "capability" = 'CAFE_STOCK_REFILL';

-- AlterEnum
BEGIN;
CREATE TYPE "Capability_new" AS ENUM ('ADMIN', 'BOOKKEEPING', 'FORTNOX_LOGIN', 'EXPORT_UNDO', 'SETTINGS', 'ALCOHOL_STOCK_VIEW', 'ALCOHOL_STOCK_MANAGE', 'BUDGET_VIEW', 'BUDGET_COMMENT', 'BUDGET_LOCK', 'BUDGET_CHANGE_LOCKED', 'ATTEST_VIEW', 'CONTRACT_VIEW', 'CONTRACT_MANAGE', 'EXPENSE_DEADLINE_WAIVE', 'REVIEW_OWN_BOOKING', 'FIRMATECKNARE', 'RENTAL_VIEW', 'RENTAL_MANAGE', 'SEND_REMINDERS', 'INVOICE_TRIAGE', 'BOOKKEEPING_VIEW', 'AUDIT_REVIEW', 'MEMBER_SCORE_VIEW', 'CAFE_STOCK_VIEW', 'CAFE_STOCK_MANAGE', 'BOARD_TAB');
ALTER TABLE "RoleCapability" ALTER COLUMN "capability" TYPE "Capability_new" USING ("capability"::text::"Capability_new");
ALTER TYPE "Capability" RENAME TO "Capability_old";
ALTER TYPE "Capability_new" RENAME TO "Capability";
DROP TYPE "public"."Capability_old";
COMMIT;

-- AlterTable
ALTER TABLE "StockEntry" ADD COLUMN     "placeId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stockPlaceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "StockPlace" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costCenterId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPlaceGroup" (
    "group" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockPlaceGroup_pkey" PRIMARY KEY ("group","placeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockPlace_stockId_name_key" ON "StockPlace"("stockId", "name");

-- CreateIndex
CREATE INDEX "StockPlaceGroup_group_idx" ON "StockPlaceGroup"("group");

-- CreateIndex
CREATE INDEX "StockEntry_placeId_idx" ON "StockEntry"("placeId");

-- AddForeignKey
ALTER TABLE "StockPlace" ADD CONSTRAINT "StockPlace_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPlace" ADD CONSTRAINT "StockPlace_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPlaceGroup" ADD CONSTRAINT "StockPlaceGroup_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "StockPlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "StockPlace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A movement belongs to a night or to a place, never both.
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_event_or_place" CHECK ("eventId" IS NULL OR "placeId" IS NULL);
