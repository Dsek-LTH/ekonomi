-- Exporting a levfaktura to Fortnox: the supplier it is billed by, the number
-- Fortnox gave it, who exported it, and the export lock that keeps it from
-- being made twice. See prisma/schema/supplier-invoice.prisma.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SupplierInvoiceEventType" ADD VALUE 'EXPORTED';
ALTER TYPE "SupplierInvoiceEventType" ADD VALUE 'EXPORT_RELEASED';

-- AlterTable
ALTER TABLE "SupplierInvoice" ADD COLUMN     "exportClaimState" "ExportClaimState",
ADD COLUMN     "exportClaimedAt" TIMESTAMP(3),
ADD COLUMN     "exportClaimedById" TEXT,
ADD COLUMN     "exportedAt" TIMESTAMP(3),
ADD COLUMN     "exportedById" TEXT,
ADD COLUMN     "fortnoxGivenNumber" TEXT,
ADD COLUMN     "fortnoxSupplierNumber" TEXT;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_exportClaimedById_fkey" FOREIGN KEY ("exportClaimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
