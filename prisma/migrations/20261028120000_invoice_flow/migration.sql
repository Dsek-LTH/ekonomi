-- The reworked levfaktura flow: konterad and attested in one step, the
-- account left to the treasurer, and discarding a real delete.
--
-- The data first, so the enums below can lose their values:
--
--   * a discarded invoice is deleted, with its rows, documents and history
--     (cascade). Its file in storage cannot be reached from SQL and stays
--     behind. The flow has not been deployed, so in practice there are none;
--   * the events that no longer exist go. SUBMITTED and RECALLED described a
--     step the flow no longer has, and DISCARDED and RESTORED an invoice that
--     is no longer kept;
--   * PENDING_APPROVAL now means partly signed. An invoice sent for attest
--     with nothing signed yet is back to waiting for its attest, ASSIGNED.
DELETE FROM "SupplierInvoice" WHERE "status" = 'DISCARDED';
DELETE FROM "SupplierInvoiceEvent" WHERE "type" IN ('SUBMITTED', 'RECALLED', 'DISCARDED', 'RESTORED');
UPDATE "SupplierInvoice" i SET "status" = 'ASSIGNED'
WHERE i."status" = 'PENDING_APPROVAL'
  AND NOT EXISTS (
    SELECT 1 FROM "SupplierInvoiceAllocation" a
    WHERE a."invoiceId" = i."id" AND a."approvedById" IS NOT NULL
  );

-- AlterEnum
BEGIN;
CREATE TYPE "SupplierInvoiceEventType_new" AS ENUM ('RECEIVED', 'EDITED', 'DOCUMENT_UPLOADED', 'DOCUMENT_REMOVED', 'ASSIGNED', 'UNASSIGNED', 'DECLINED', 'COST_CENTER_APPROVED', 'ATTEST_WITHDRAWN', 'CHANGES_REQUESTED', 'APPROVED');
ALTER TABLE "SupplierInvoiceEvent" ALTER COLUMN "type" TYPE "SupplierInvoiceEventType_new" USING ("type"::text::"SupplierInvoiceEventType_new");
ALTER TYPE "SupplierInvoiceEventType" RENAME TO "SupplierInvoiceEventType_old";
ALTER TYPE "SupplierInvoiceEventType_new" RENAME TO "SupplierInvoiceEventType";
DROP TYPE "public"."SupplierInvoiceEventType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "SupplierInvoiceStatus_new" AS ENUM ('INBOX', 'ASSIGNED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'EXPORTED');
ALTER TABLE "public"."SupplierInvoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "SupplierInvoice" ALTER COLUMN "status" TYPE "SupplierInvoiceStatus_new" USING ("status"::text::"SupplierInvoiceStatus_new");
ALTER TYPE "SupplierInvoiceStatus" RENAME TO "SupplierInvoiceStatus_old";
ALTER TYPE "SupplierInvoiceStatus_new" RENAME TO "SupplierInvoiceStatus";
DROP TYPE "public"."SupplierInvoiceStatus_old";
ALTER TABLE "SupplierInvoice" ALTER COLUMN "status" SET DEFAULT 'INBOX';
COMMIT;

-- AlterTable
ALTER TABLE "SupplierInvoiceAllocation" ALTER COLUMN "account" DROP NOT NULL,
ALTER COLUMN "amount" DROP NOT NULL;
