-- "Vår referens" on a levfaktura, written at the booking and sent to Fortnox
-- as OurReference.
ALTER TABLE "SupplierInvoice" ADD COLUMN "ourReference" TEXT;
