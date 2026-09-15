-- Counterparties are deleted rather than deactivated. Ones already deactivated
-- go too: an agreement that named one keeps its own copy of the details, and
-- loses only the link back (AgreementDetails.counterpartyId is SET NULL).
DELETE FROM "Counterparty" WHERE "active" = false;
-- DropIndex
DROP INDEX "Counterparty_active_idx";

-- AlterTable
ALTER TABLE "Counterparty" DROP COLUMN "active";

