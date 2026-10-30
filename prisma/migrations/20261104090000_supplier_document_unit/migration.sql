-- A levfaktura is born when its unit fördelar it. Until then it is a document
-- in that unit's Inkorg, so a document says which unit it was given to.
ALTER TABLE "SupplierInvoiceDocument" ADD COLUMN "resultUnitId" TEXT;
ALTER TABLE "SupplierInvoiceDocument" ADD COLUMN "assignedById" TEXT;
ALTER TABLE "SupplierInvoiceDocument" ADD COLUMN "assignedAt" TIMESTAMP(3);

CREATE INDEX "SupplierInvoiceDocument_resultUnitId_idx" ON "SupplierInvoiceDocument"("resultUnitId");

ALTER TABLE "SupplierInvoiceDocument" ADD CONSTRAINT "SupplierInvoiceDocument_resultUnitId_fkey"
    FOREIGN KEY ("resultUnitId") REFERENCES "ResultUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceDocument" ADD CONSTRAINT "SupplierInvoiceDocument_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An invoice given to a unit that has never fördelat it was made too early.
-- Its documents go to that unit's Inkorg, and the invoice goes. One with a
-- split, even one reopened since, stays an invoice.
UPDATE "SupplierInvoiceDocument" d
SET "invoiceId" = NULL,
    "position" = 0,
    "resultUnitId" = i."resultUnitId",
    "assignedById" = i."assignedById",
    "assignedAt" = i."assignedAt"
FROM "SupplierInvoice" i
WHERE d."invoiceId" = i."id"
  AND i."status" = 'ASSIGNED'
  AND NOT EXISTS (SELECT 1 FROM "SupplierInvoiceAllocation" a WHERE a."invoiceId" = i."id");

DELETE FROM "SupplierInvoice" i
WHERE i."status" = 'ASSIGNED'
  AND NOT EXISTS (SELECT 1 FROM "SupplierInvoiceAllocation" a WHERE a."invoiceId" = i."id");

-- Every invoice is now made with a status of its own.
ALTER TABLE "SupplierInvoice" ALTER COLUMN "status" DROP DEFAULT;
