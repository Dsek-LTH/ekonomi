-- "Plats" is gone from the rental form and from the document it draws, so
-- the column that held it goes too.

-- AlterTable
ALTER TABLE "RentalDetails" DROP COLUMN "place";
