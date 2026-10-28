-- The levfaktura Inkorg: a document can exist without an invoice, waiting to
-- be made into one, added to one, or deleted. Deleting an invoice now puts its
-- documents back there rather than deleting them. See SupplierInvoiceDocument.

-- AlterEnum
ALTER TYPE "SupplierInvoiceEventType" ADD VALUE 'DOCUMENT_ATTACHED';

-- DropForeignKey
ALTER TABLE "SupplierInvoiceDocument" DROP CONSTRAINT "SupplierInvoiceDocument_invoiceId_fkey";

-- DropIndex
DROP INDEX "SupplierInvoiceDocument_invoiceId_idx";

-- AlterTable
ALTER TABLE "SupplierInvoiceDocument" ADD COLUMN     "inboundMailId" TEXT,
ALTER COLUMN "invoiceId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "SupplierInvoiceDocument_invoiceId_createdAt_idx" ON "SupplierInvoiceDocument"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierInvoiceDocument_inboundMailId_idx" ON "SupplierInvoiceDocument"("inboundMailId");

-- AddForeignKey
ALTER TABLE "SupplierInvoiceDocument" ADD CONSTRAINT "SupplierInvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceDocument" ADD CONSTRAINT "SupplierInvoiceDocument_inboundMailId_fkey" FOREIGN KEY ("inboundMailId") REFERENCES "InboundMail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A document that came by mail remembers which, so the Inkorg can show who
-- sent it. The ones already here learn it from their invoice.
UPDATE "SupplierInvoiceDocument" d SET "inboundMailId" = i."inboundMailId"
FROM "SupplierInvoice" i
WHERE d."invoiceId" = i."id" AND i."inboundMailId" IS NOT NULL;
