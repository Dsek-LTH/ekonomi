-- AlterTable
ALTER TABLE "AgreementDetails" ALTER COLUMN "counterparty" DROP NOT NULL,
ALTER COLUMN "status" DROP NOT NULL,
ALTER COLUMN "status" DROP DEFAULT;
