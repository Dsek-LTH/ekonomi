-- Replace the single-role model with a multi-role model, and add committee
-- masterships (utskottsmästare ↔ utskott) that drive attest authority.

-- Drop the deprecated single-role index.
DROP INDEX IF EXISTS "User_role_idx";

-- Swap the Role enum for the new multi-role values. The old `role` column is the
-- only consumer, so drop it first, then recreate the type.
ALTER TABLE "User" DROP COLUMN IF EXISTS "role";
DROP TYPE "Role";
CREATE TYPE "Role" AS ENUM ('SKATTMASTARE', 'ORDFORANDE', 'VICE_SKATTMASTARE', 'SKATTFORMAN', 'UTSKOTTSMASTARE', 'ORDINARIE');
ALTER TABLE "User" ADD COLUMN "roles" "Role"[] NOT NULL DEFAULT ARRAY['ORDINARIE']::"Role"[];

-- Committee masterships (many-to-many user ↔ committee).
CREATE TABLE "CommitteeMastership" (
    "id" TEXT NOT NULL,
    "committee" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitteeMastership_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CommitteeMastership_committee_idx" ON "CommitteeMastership"("committee");
CREATE UNIQUE INDEX "CommitteeMastership_userId_committee_key" ON "CommitteeMastership"("userId", "committee");
ALTER TABLE "CommitteeMastership" ADD CONSTRAINT "CommitteeMastership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
