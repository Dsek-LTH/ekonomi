-- Every levfaktura is born belonging to a result unit. Anything nobody has yet
-- said is whose is a document in the Inkorg, not an invoice, so the INBOX
-- status goes, and with it the events for leaving it.
--
-- The data first, so the enums below can lose their values: an invoice still
-- in INBOX gives its documents back to the Inkorg and is deleted, history and
-- all (cascade), which is what sending one back to the Inkorg now does. The
-- UNASSIGNED and DECLINED events were only ever on such a round trip.
UPDATE "SupplierInvoiceDocument" d SET "invoiceId" = NULL, "position" = 0
FROM "SupplierInvoice" i
WHERE d."invoiceId" = i."id" AND i."status" = 'INBOX';
DELETE FROM "SupplierInvoice" WHERE "status" = 'INBOX';
DELETE FROM "SupplierInvoiceEvent" WHERE "type" IN ('UNASSIGNED', 'DECLINED');

-- AlterEnum
BEGIN;
CREATE TYPE "SupplierInvoiceEventType_new" AS ENUM ('RECEIVED', 'EDITED', 'DOCUMENT_UPLOADED', 'DOCUMENT_REMOVED', 'ASSIGNED', 'COST_CENTER_APPROVED', 'ATTEST_WITHDRAWN', 'CHANGES_REQUESTED', 'APPROVED', 'DOCUMENT_ATTACHED', 'EXPORTED', 'EXPORT_RELEASED');
ALTER TABLE "SupplierInvoiceEvent" ALTER COLUMN "type" TYPE "SupplierInvoiceEventType_new" USING ("type"::text::"SupplierInvoiceEventType_new");
ALTER TYPE "SupplierInvoiceEventType" RENAME TO "SupplierInvoiceEventType_old";
ALTER TYPE "SupplierInvoiceEventType_new" RENAME TO "SupplierInvoiceEventType";
DROP TYPE "public"."SupplierInvoiceEventType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "SupplierInvoiceStatus_new" AS ENUM ('ASSIGNED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'EXPORTED');
ALTER TABLE "public"."SupplierInvoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "SupplierInvoice" ALTER COLUMN "status" TYPE "SupplierInvoiceStatus_new" USING ("status"::text::"SupplierInvoiceStatus_new");
ALTER TYPE "SupplierInvoiceStatus" RENAME TO "SupplierInvoiceStatus_old";
ALTER TYPE "SupplierInvoiceStatus_new" RENAME TO "SupplierInvoiceStatus";
DROP TYPE "public"."SupplierInvoiceStatus_old";
ALTER TABLE "SupplierInvoice" ALTER COLUMN "status" SET DEFAULT 'ASSIGNED';
COMMIT;

-- AlterTable
ALTER TABLE "SupplierInvoice" ALTER COLUMN "status" SET DEFAULT 'ASSIGNED';

-- AlterTable
ALTER TABLE "SupplierInvoiceDocument" ADD COLUMN     "returnNote" TEXT,
ADD COLUMN     "returnedFrom" TEXT;
