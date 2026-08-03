-- DropIndex
DROP INDEX "BudgetRevision_budgetId_idx";

-- AlterTable
ALTER TABLE "FortnoxConnection" ADD COLUMN     "orgNumber" TEXT;

-- CreateTable
CREATE TABLE "FortnoxUserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "fortnoxUserName" TEXT,
    "fortnoxUserEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FortnoxUserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FortnoxUserSession_userId_key" ON "FortnoxUserSession"("userId");

-- AddForeignKey
ALTER TABLE "FortnoxUserSession" ADD CONSTRAINT "FortnoxUserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
