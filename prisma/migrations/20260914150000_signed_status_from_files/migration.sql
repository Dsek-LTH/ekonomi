-- A contract is Signerat when its signed copy is in the archive and Utkast
-- until then, so the stored status goes, along with the states nothing sets
-- any more. Parties go too: a rental asks for a number of signatures, and the
-- signed document is the record of who signed.

-- Keep what production already says. An agreement filed as signed, or signed
-- and later terminated, had its document uploaded as a plain ORIGINAL, so that
-- document becomes its signed copy. An agreement with no uploaded document (a
-- rental with only the drawn PDF included) becomes a draft, and so does every
-- contract that was never signed, cancelled ones included.
UPDATE "ContractFile" f
SET "role" = 'SIGNED'
FROM "AgreementDetails" a
JOIN "Contract" c ON c."id" = a."contractId"
WHERE f."contractId" = a."contractId"
  AND c."kind" = 'CONTRACT'
  AND a."status" IN ('SIGNED', 'TERMINATED')
  AND f."role" = 'ORIGINAL';

-- DropForeignKey
ALTER TABLE "ContractParty" DROP CONSTRAINT "ContractParty_contractId_fkey";

-- DropForeignKey
ALTER TABLE "ContractParty" DROP CONSTRAINT "ContractParty_userId_fkey";

-- DropIndex
DROP INDEX "AgreementDetails_status_idx";

-- AlterTable
ALTER TABLE "AgreementDetails" DROP COLUMN "status";

-- DropTable
DROP TABLE "ContractParty";

-- DropEnum
DROP TYPE "ContractPartyRole";

-- DropEnum
DROP TYPE "ContractSignatureMethod";

-- DropEnum
DROP TYPE "ContractStatus";

