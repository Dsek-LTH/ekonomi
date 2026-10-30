-- Konterad as its own step before a levfaktura is sent to Fortnox, the way an
-- utlägg is BOOKED before it is EXPORTED.
ALTER TYPE "SupplierInvoiceStatus" ADD VALUE 'BOOKED' AFTER 'APPROVED';
ALTER TYPE "SupplierInvoiceEventType" ADD VALUE 'BOOKED' AFTER 'APPROVED';
