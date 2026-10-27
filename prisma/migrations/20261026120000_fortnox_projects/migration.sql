-- CreateTable
CREATE TABLE "Project" (
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("number")
);

-- CreateIndex
CREATE INDEX "Project_active_idx" ON "Project"("active");

-- AlterTable
ALTER TABLE "VerificationLine" ADD COLUMN     "project" TEXT;
