-- Who has a levfaktura's kontering open, as ExpensePresence does for an utlägg's booking screen.
CREATE TABLE "SupplierInvoicePresence" (
    "invoiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoicePresence_pkey" PRIMARY KEY ("invoiceId","userId")
);

CREATE INDEX "SupplierInvoicePresence_lastSeenAt_idx" ON "SupplierInvoicePresence"("lastSeenAt");

ALTER TABLE "SupplierInvoicePresence" ADD CONSTRAINT "SupplierInvoicePresence_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierInvoicePresence" ADD CONSTRAINT "SupplierInvoicePresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
