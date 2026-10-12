-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "counterpartyId" TEXT;

-- CreateTable
CREATE TABLE "Counterparty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgNo" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Counterparty_name_idx" ON "Counterparty"("name");

-- CreateIndex
CREATE INDEX "Counterparty_active_idx" ON "Counterparty"("active");

-- CreateIndex
CREATE INDEX "Contract_counterpartyId_idx" ON "Contract"("counterpartyId");

-- AddForeignKey
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
