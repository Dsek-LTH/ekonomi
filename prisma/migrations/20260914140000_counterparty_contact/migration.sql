-- The counterparty directory keeps an email and a phone number too, both
-- optional, so a new contract picking the row gets them filled in.

-- AlterTable
ALTER TABLE "Counterparty" ADD COLUMN "email" TEXT,
ADD COLUMN "phone" TEXT;

-- Filled from the most recent agreement with the row that states either, so
-- what the section already typed once is not lost.
UPDATE "Counterparty" c
SET "email" = a."counterpartyEmail", "phone" = a."counterpartyPhone"
FROM (
  SELECT DISTINCT ON (ad."counterpartyId") ad."counterpartyId", ad."counterpartyEmail", ad."counterpartyPhone"
  FROM "AgreementDetails" ad
  JOIN "Contract" ct ON ct."id" = ad."contractId"
  WHERE ad."counterpartyId" IS NOT NULL
    AND (ad."counterpartyEmail" IS NOT NULL OR ad."counterpartyPhone" IS NOT NULL)
  ORDER BY ad."counterpartyId", ct."createdAt" DESC
) a
WHERE c."id" = a."counterpartyId";
