-- Fortnox export tracking on the voucher.
ALTER TABLE "Verification" ADD COLUMN "fortnoxSeries" TEXT;
ALTER TABLE "Verification" ADD COLUMN "fortnoxNumber" INTEGER;
ALTER TABLE "Verification" ADD COLUMN "fortnoxYear" INTEGER;
ALTER TABLE "Verification" ADD COLUMN "exportedAt" TIMESTAMP(3);

-- Stored OAuth2 connection to the org's Fortnox company (singleton in practice).
CREATE TABLE "FortnoxConnection" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
    "voucherSeries" TEXT NOT NULL DEFAULT 'A',
    "companyName" TEXT,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FortnoxConnection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FortnoxConnection" ADD CONSTRAINT "FortnoxConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
