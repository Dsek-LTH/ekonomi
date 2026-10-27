-- What the invoice PDF said, read off its text layer: "Er referens", and which
-- fields were filled in from the PDF rather than typed.

-- AlterTable
ALTER TABLE "SupplierInvoice" ADD COLUMN     "prefilled" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "yourReference" TEXT;
