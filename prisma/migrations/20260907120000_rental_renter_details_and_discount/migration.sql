-- Where the renter can be reached on paper. Nullable, because the archive also
-- holds contracts that arrived as a scan with whatever the scan says on it; the
-- rental form requires them. See CreateRental.
ALTER TABLE "Contract" ADD COLUMN     "counterpartyAddress" TEXT,
ADD COLUMN     "counterpartyCity" TEXT,
ADD COLUMN     "counterpartyPostalCode" TEXT;

-- The deposit goes, and a discount takes the place of the second price field.
-- The section has never taken a deposit, so the column, the clause in the
-- villkor and the branch in the state machine all described something that
-- never happened.
ALTER TABLE "RentalDetails" DROP COLUMN "depositOre",
DROP COLUMN "depositReturnedAt",
ADD COLUMN     "discountOre" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subtotalOre" INTEGER NOT NULL DEFAULT 0;

-- Existing rentals, restated in the new shape.
--
-- `priceOre` is what was agreed and stays exactly as it is: it is on a document
-- somebody signed. The other two are chosen so the arithmetic holds for every
-- row, including the ones priced above their lines, where the agreed price is
-- taken as the subtotal and nothing was discounted. A correlated subquery
-- rather than a join, so a rental with no lines is updated too.
UPDATE "RentalDetails" rd
SET "subtotalOre" = GREATEST(
      COALESCE((SELECT SUM(l."unitPriceOre" * l."quantity")
                FROM "RentalLine" l WHERE l."contractId" = rd."contractId"), 0),
      rd."priceOre"),
    "discountOre" = GREATEST(
      COALESCE((SELECT SUM(l."unitPriceOre" * l."quantity")
                FROM "RentalLine" l WHERE l."contractId" = rd."contractId"), 0),
      rd."priceOre") - rd."priceOre";
