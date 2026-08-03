-- Section positions on users + committee owners (attest-policy groundwork).

CREATE TYPE "CommitteePosition" AS ENUM ('ORDFORANDE', 'SKATTMASTARE', 'VICE_SKATTMASTARE', 'BOARD');

ALTER TABLE "User" ADD COLUMN "position" "CommitteePosition";

CREATE TABLE "CommitteeOwner" (
    "id" TEXT NOT NULL,
    "committee" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommitteeOwner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommitteeOwner_committee_key" ON "CommitteeOwner"("committee");

ALTER TABLE "CommitteeOwner" ADD CONSTRAINT "CommitteeOwner_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
