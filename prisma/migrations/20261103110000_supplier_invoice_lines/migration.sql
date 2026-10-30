-- The treasury's kontering of a levfaktura as free voucher lines, beside the
-- attested split it starts out from.
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "account" TEXT NOT NULL,
    "costCenterCode" TEXT,
    "project" TEXT,
    "description" TEXT,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierInvoiceLine_invoiceId_idx" ON "SupplierInvoiceLine"("invoiceId");

ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What was already konterat, the account on an attested row, carried over as
-- a line: the row's share, or the whole amount on an invoice of one row.
INSERT INTO "SupplierInvoiceLine" ("id", "invoiceId", "position", "account", "costCenterCode", "project", "description", "debit")
SELECT 'l' || a."id", a."invoiceId", a."position", a."account", c."code", a."project", a."comment",
       COALESCE(a."amount", i."amount", 0)
FROM "SupplierInvoiceAllocation" a
JOIN "SupplierInvoice" i ON i."id" = a."invoiceId"
JOIN "CostCenter" c ON c."id" = a."costCenterId"
WHERE a."account" IS NOT NULL;
