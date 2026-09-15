-- A rental asks how many will sign for the renter rather than naming them,
-- and the renter's email and phone move from the named signatory onto the
-- agreement.

-- AlterTable
ALTER TABLE "AgreementDetails" ADD COLUMN "counterpartyEmail" TEXT,
ADD COLUMN "counterpartyPhone" TEXT;

-- AlterTable
ALTER TABLE "RentalDetails" ADD COLUMN "signatureCount" INTEGER NOT NULL DEFAULT 1;

-- Existing rentals keep what their named signatories said: one block per
-- person already named, and the first named person's contact details.
UPDATE "RentalDetails" r
SET "signatureCount" = GREATEST(1, LEAST(10, (
  SELECT COUNT(*) FROM "ContractParty" p
  WHERE p."contractId" = r."contractId" AND p."role" = 'COUNTERPARTY'
)));

UPDATE "AgreementDetails" a
SET "counterpartyEmail" = p."email", "counterpartyPhone" = p."phone"
FROM (
  SELECT DISTINCT ON ("contractId") "contractId", "email", "phone"
  FROM "ContractParty"
  WHERE "role" = 'COUNTERPARTY'
  ORDER BY "contractId", "createdAt", "id"
) p
JOIN "RentalDetails" r ON r."contractId" = p."contractId"
WHERE a."contractId" = p."contractId";
