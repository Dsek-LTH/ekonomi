-- Leverantörsfakturor: the inkorg, the kontering and the attest. See
-- prisma/schema/supplier-invoice.prisma for what each table is.
--
-- The capability that keeps the inkorg is granted in the next migration.
-- Postgres will not let a transaction use an enum value added by that same
-- transaction.

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('INBOX', 'ASSIGNED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'EXPORTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceSource" AS ENUM ('UPLOAD', 'EMAIL');

-- CreateEnum
CREATE TYPE "SupplierInvoiceEventType" AS ENUM ('RECEIVED', 'EDITED', 'DOCUMENT_UPLOADED', 'DOCUMENT_REMOVED', 'ASSIGNED', 'UNASSIGNED', 'SUBMITTED', 'RECALLED', 'COST_CENTER_APPROVED', 'CHANGES_REQUESTED', 'APPROVED', 'DISCARDED', 'RESTORED');

-- AlterEnum
ALTER TYPE "Capability" ADD VALUE 'INVOICE_TRIAGE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'SUPPLIER_INVOICE_ASSIGNED';
ALTER TYPE "NotificationKind" ADD VALUE 'SUPPLIER_INVOICE_SUBMITTED';

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'INBOX',
    "source" "SupplierInvoiceSource" NOT NULL,
    "receivedById" TEXT,
    "description" TEXT,
    "supplierName" TEXT,
    "supplierOrgNo" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" DATE,
    "dueDate" DATE,
    "amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'SEK',
    "ocr" TEXT,
    "bankgiro" TEXT,
    "plusgiro" TEXT,
    "resultUnitId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceAllocation" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "project" TEXT,
    "amount" INTEGER NOT NULL,
    "comment" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierInvoiceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceDocument" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER,
    "uploadedById" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceEvent" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "type" "SupplierInvoiceEventType" NOT NULL,
    "actorId" TEXT,
    "comment" TEXT,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierInvoice_status_createdAt_id_idx" ON "SupplierInvoice"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SupplierInvoice_resultUnitId_status_idx" ON "SupplierInvoice"("resultUnitId", "status");

-- CreateIndex
CREATE INDEX "SupplierInvoice_dueDate_id_idx" ON "SupplierInvoice"("dueDate", "id");

-- CreateIndex
CREATE INDEX "SupplierInvoiceAllocation_invoiceId_idx" ON "SupplierInvoiceAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceAllocation_costCenterId_idx" ON "SupplierInvoiceAllocation"("costCenterId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceDocument_invoiceId_idx" ON "SupplierInvoiceDocument"("invoiceId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceEvent_invoiceId_idx" ON "SupplierInvoiceEvent"("invoiceId");

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_resultUnitId_fkey" FOREIGN KEY ("resultUnitId") REFERENCES "ResultUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceAllocation" ADD CONSTRAINT "SupplierInvoiceAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceAllocation" ADD CONSTRAINT "SupplierInvoiceAllocation_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceAllocation" ADD CONSTRAINT "SupplierInvoiceAllocation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceDocument" ADD CONSTRAINT "SupplierInvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceDocument" ADD CONSTRAINT "SupplierInvoiceDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceEvent" ADD CONSTRAINT "SupplierInvoiceEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceEvent" ADD CONSTRAINT "SupplierInvoiceEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

