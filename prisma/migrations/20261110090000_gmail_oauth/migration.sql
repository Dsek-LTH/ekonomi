-- The inkorg mailbox is read with a refresh token from logging in as it once, instead of a service account.
ALTER TABLE "GmailSync" ADD COLUMN "refreshToken" TEXT,
ADD COLUMN "connectedAddress" TEXT,
ADD COLUMN "connectedById" TEXT,
ADD COLUMN "connectedAt" TIMESTAMP(3);

ALTER TABLE "GmailSync" ADD CONSTRAINT "GmailSync_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
