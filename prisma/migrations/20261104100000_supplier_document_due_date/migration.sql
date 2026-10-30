-- The due date triage can give a document as it sends it to a unit.
ALTER TABLE "SupplierInvoiceDocument" ADD COLUMN "dueDate" DATE;
