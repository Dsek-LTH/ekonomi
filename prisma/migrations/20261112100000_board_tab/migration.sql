-- The board's tab and the customer invoices made from it (docs/stock.md).

-- CreateEnum
CREATE TYPE "CustomerInvoiceSource" AS ENUM ('BOARD_TAB');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fortnoxCustomerNumber" TEXT;

-- CreateTable
CREATE TABLE "BoardPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceOre" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardWithdrawal" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceOre" INTEGER NOT NULL,
    "loggedById" TEXT NOT NULL,
    "invoiceLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerInvoice" (
    "id" TEXT NOT NULL,
    "source" "CustomerInvoiceSource" NOT NULL,
    "customerId" TEXT NOT NULL,
    "fiscalYearId" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "invoiceDate" DATE NOT NULL,
    "totalOre" INTEGER NOT NULL,
    "fortnoxCustomerNumber" TEXT,
    "fortnoxDocumentNumber" TEXT,
    "exportedAt" TIMESTAMP(3),
    "exportedById" TEXT,
    "exportClaimedAt" TIMESTAMP(3),
    "exportClaimState" "ExportClaimState",
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceOre" INTEGER NOT NULL,
    "amountOre" INTEGER NOT NULL,
    "account" TEXT NOT NULL,
    "costCenterId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardPrice_productId_validFrom_key" ON "BoardPrice"("productId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BoardWithdrawal_entryId_key" ON "BoardWithdrawal"("entryId");

-- CreateIndex
CREATE INDEX "BoardWithdrawal_memberId_invoiceLineId_idx" ON "BoardWithdrawal"("memberId", "invoiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInvoice_source_customerId_fiscalYearId_sequence_key" ON "CustomerInvoice"("source", "customerId", "fiscalYearId", "sequence");

-- CreateIndex
CREATE INDEX "CustomerInvoiceLine_invoiceId_idx" ON "CustomerInvoiceLine"("invoiceId");

-- AddForeignKey
ALTER TABLE "BoardPrice" ADD CONSTRAINT "BoardPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StockProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardPrice" ADD CONSTRAINT "BoardPrice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardWithdrawal" ADD CONSTRAINT "BoardWithdrawal_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "StockEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardWithdrawal" ADD CONSTRAINT "BoardWithdrawal_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardWithdrawal" ADD CONSTRAINT "BoardWithdrawal_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardWithdrawal" ADD CONSTRAINT "BoardWithdrawal_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "CustomerInvoiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoiceLine" ADD CONSTRAINT "CustomerInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CustomerInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoiceLine" ADD CONSTRAINT "CustomerInvoiceLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

