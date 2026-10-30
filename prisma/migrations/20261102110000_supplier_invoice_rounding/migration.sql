-- Öresutjämning on a levfaktura, öre, signed, booked on its own account at
-- the export.
ALTER TABLE "SupplierInvoice" ADD COLUMN "rounding" INTEGER;
