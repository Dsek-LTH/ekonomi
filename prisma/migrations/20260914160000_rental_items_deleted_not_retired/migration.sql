-- Rental items are deleted rather than deactivated. Items already deactivated
-- go too: a contract line that quoted one keeps its own copy of the name and
-- the prices, and loses only the link back (RentalLine.itemId is SET NULL).
DELETE FROM "RentalItem" WHERE "active" = false;
-- DropIndex
DROP INDEX "RentalItem_active_idx";

-- AlterTable
ALTER TABLE "RentalItem" DROP COLUMN "active";

