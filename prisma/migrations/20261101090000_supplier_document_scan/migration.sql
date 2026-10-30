-- What each levfaktura document's text layer says, read on arrival.
ALTER TABLE "SupplierInvoiceDocument" ADD COLUMN "scan" JSONB;
ALTER TABLE "SupplierInvoiceDocument" ADD COLUMN "scannedAt" TIMESTAMP(3);

-- A copy of Fortnox's supplier register, to match documents against.
CREATE TABLE "Supplier" (
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgNo" TEXT,
    "bankgiro" TEXT,
    "plusgiro" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("number")
);
