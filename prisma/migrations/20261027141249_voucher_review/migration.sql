-- Bokslut: reviews of a financial year's vouchers, and the comments on them.
-- See prisma/schema/closing.prisma.

-- CreateEnum
CREATE TYPE "VoucherReviewPass" AS ENUM ('PREPARER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "VoucherReviewStatus" AS ENUM ('OK', 'QUESTION', 'REMARK');

-- AlterEnum
ALTER TYPE "Capability" ADD VALUE 'AUDIT_REVIEW';

-- AlterTable
ALTER TABLE "LedgerVoucher" ADD COLUMN     "contentHash" TEXT;

-- CreateTable
CREATE TABLE "VoucherReview" (
    "id" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "pass" "VoucherReviewPass" NOT NULL,
    "status" "VoucherReviewStatus" NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherComment" (
    "id" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoucherReview_financialYear_series_number_pass_reviewedAt_idx" ON "VoucherReview"("financialYear", "series", "number", "pass", "reviewedAt");

-- CreateIndex
CREATE INDEX "VoucherComment_financialYear_series_number_createdAt_idx" ON "VoucherComment"("financialYear", "series", "number", "createdAt");

-- AddForeignKey
ALTER TABLE "VoucherReview" ADD CONSTRAINT "VoucherReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherComment" ADD CONSTRAINT "VoucherComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
