-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "holderId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Card_last4_key" ON "Card"("last4");
CREATE INDEX "Card_holderId_idx" ON "Card"("holderId");

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "cardId" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN "cardLast4" TEXT;
CREATE INDEX "BankTransaction_cardId_idx" ON "BankTransaction"("cardId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
