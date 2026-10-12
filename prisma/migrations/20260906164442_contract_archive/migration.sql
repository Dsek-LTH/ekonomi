-- CreateEnum
CREATE TYPE "ContractKind" AS ENUM ('RENTAL', 'SPONSORSHIP', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'OUT_FOR_SIGNATURE', 'SIGNED', 'TERMINATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractFileRole" AS ENUM ('ORIGINAL', 'GENERATED', 'SIGNED', 'EVIDENCE', 'ATTACHMENT');

-- CreateEnum
CREATE TYPE "ContractPartyRole" AS ENUM ('SECTION', 'COUNTERPARTY');

-- CreateEnum
CREATE TYPE "ContractSignatureMethod" AS ENUM ('PAPER', 'ELECTRONIC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Capability" ADD VALUE 'CONTRACT_VIEW';
ALTER TYPE "Capability" ADD VALUE 'CONTRACT_MANAGE';

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "kind" "ContractKind" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "counterpartyOrgNo" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "termsVersion" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractFile" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "role" "ContractFileRole" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractParty" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "role" "ContractPartyRole" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "orgName" TEXT,
    "orgNo" TEXT,
    "userId" TEXT,
    "title" TEXT,
    "signedAt" TIMESTAMP(3),
    "signatureMethod" "ContractSignatureMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalDetails" (
    "contractId" TEXT NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "returnAt" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "place" TEXT,
    "priceOre" INTEGER NOT NULL DEFAULT 0,
    "depositOre" INTEGER NOT NULL DEFAULT 0,
    "depositReturnedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalDetails_pkey" PRIMARY KEY ("contractId")
);

-- CreateTable
CREATE TABLE "RentalLine" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceOre" INTEGER NOT NULL DEFAULT 0,
    "replacementValueOre" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RentalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dailyPriceOre" INTEGER,
    "replacementValueOre" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_kind_idx" ON "Contract"("kind");

-- CreateIndex
CREATE INDEX "Contract_validTo_idx" ON "Contract"("validTo");

-- CreateIndex
CREATE INDEX "Contract_tags_idx" ON "Contract" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "ContractFile_objectKey_key" ON "ContractFile"("objectKey");

-- CreateIndex
CREATE INDEX "ContractFile_contractId_idx" ON "ContractFile"("contractId");

-- CreateIndex
CREATE INDEX "ContractFile_contractId_role_idx" ON "ContractFile"("contractId", "role");

-- CreateIndex
CREATE INDEX "ContractParty_contractId_idx" ON "ContractParty"("contractId");

-- CreateIndex
CREATE INDEX "ContractParty_userId_idx" ON "ContractParty"("userId");

-- CreateIndex
CREATE INDEX "RentalLine_contractId_idx" ON "RentalLine"("contractId");

-- CreateIndex
CREATE INDEX "RentalLine_itemId_idx" ON "RentalLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalItem_name_key" ON "RentalItem"("name");

-- CreateIndex
CREATE INDEX "RentalItem_active_idx" ON "RentalItem"("active");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractFile" ADD CONSTRAINT "ContractFile_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractFile" ADD CONSTRAINT "ContractFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractParty" ADD CONSTRAINT "ContractParty_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractParty" ADD CONSTRAINT "ContractParty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalDetails" ADD CONSTRAINT "RentalDetails_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalLine" ADD CONSTRAINT "RentalLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "RentalDetails"("contractId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalLine" ADD CONSTRAINT "RentalLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RentalItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
