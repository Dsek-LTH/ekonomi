-- Fold RENTAL/SPONSORSHIP/SUPPLIER/PERMIT into one CONTRACT kind, and move
-- everything agreement-specific (counterparty, validity, status) off
-- Contract onto a new AgreementDetails table. PROTOCOL and OTHER keep to
-- Contract's own columns plus one date; see the schema file's own comments
-- for why.
--
-- Order matters here in a way a generated migration would not get right on
-- its own: CONTRACT has to exist as a value before any row can be set to
-- it, every row's agreement data has to be carried into AgreementDetails
-- before the source columns are dropped, and the enum can only shrink once
-- no row still holds a value being removed. See
-- 20260807090000_drop_rejected_status for the enum-swap pattern this
-- follows; that one didn't need the extra ADD VALUE step because it only
-- ever remapped onto a value that already existed in the old enum. CONTRACT
-- does not, so it has to be added first, and (Postgres rule) not inside the
-- same transaction that then uses it.

-- Step 1: add the new value additively. Not inside a transaction block: a
-- newly added enum value cannot be used by statements in the same
-- transaction that added it.
ALTER TYPE "ContractKind" ADD VALUE 'CONTRACT';

-- Step 2: remap every row that is becoming a plain CONTRACT. Its own
-- statement, auto-committed, so the value from step 1 is visible to it.
UPDATE "Contract" SET "kind" = 'CONTRACT' WHERE "kind" IN ('RENTAL', 'SPONSORSHIP', 'SUPPLIER', 'PERMIT');

-- Step 3: create the destination table and carry every now-CONTRACT row's
-- agreement data into it, before the source columns are dropped from
-- Contract. No constraints yet: they're added in step 6, once the data is
-- in place, to keep this step to exactly "copy the rows."
CREATE TABLE "AgreementDetails" (
    "contractId" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "counterpartyOrgNo" TEXT,
    "counterpartyAddress" TEXT,
    "counterpartyPostalCode" TEXT,
    "counterpartyCity" TEXT,
    "counterpartyId" TEXT,
    "validFrom" DATE,
    "validTo" DATE,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "termsVersion" TEXT,

    CONSTRAINT "AgreementDetails_pkey" PRIMARY KEY ("contractId")
);

INSERT INTO "AgreementDetails" ("contractId", "counterparty", "counterpartyOrgNo", "counterpartyAddress", "counterpartyPostalCode", "counterpartyCity", "counterpartyId", "validFrom", "validTo", "status", "termsVersion")
SELECT "id", "counterparty", "counterpartyOrgNo", "counterpartyAddress", "counterpartyPostalCode", "counterpartyCity", "counterpartyId", "validFrom", "validTo", "status", "termsVersion"
FROM "Contract"
WHERE "kind" = 'CONTRACT';

-- Step 4: shrink the enum, safe now that no row holds a value outside
-- {CONTRACT, PROTOCOL, OTHER}.
BEGIN;
CREATE TYPE "ContractKind_new" AS ENUM ('CONTRACT', 'PROTOCOL', 'OTHER');
ALTER TABLE "Contract" ALTER COLUMN "kind" TYPE "ContractKind_new" USING ("kind"::text::"ContractKind_new");
ALTER TYPE "ContractKind" RENAME TO "ContractKind_old";
ALTER TYPE "ContractKind_new" RENAME TO "ContractKind";
DROP TYPE "public"."ContractKind_old";
COMMIT;

-- Step 5: drop the columns (and their FK/indexes) now that their data lives
-- in AgreementDetails, and add the lean-document date column.
ALTER TABLE "Contract" DROP CONSTRAINT "Contract_counterpartyId_fkey";
DROP INDEX "Contract_counterpartyId_idx";
DROP INDEX "Contract_status_idx";
DROP INDEX "Contract_validTo_idx";

ALTER TABLE "Contract"
DROP COLUMN "counterparty",
DROP COLUMN "counterpartyAddress",
DROP COLUMN "counterpartyCity",
DROP COLUMN "counterpartyId",
DROP COLUMN "counterpartyOrgNo",
DROP COLUMN "counterpartyPostalCode",
DROP COLUMN "status",
DROP COLUMN "termsVersion",
DROP COLUMN "validFrom",
DROP COLUMN "validTo",
ADD COLUMN "date" DATE;

-- Step 6: AgreementDetails' own indexes and foreign keys, added last so
-- step 3's insert was never checked against anything but itself.
CREATE INDEX "AgreementDetails_status_idx" ON "AgreementDetails"("status");
CREATE INDEX "AgreementDetails_validTo_idx" ON "AgreementDetails"("validTo");
CREATE INDEX "AgreementDetails_counterpartyId_idx" ON "AgreementDetails"("counterpartyId");

ALTER TABLE "AgreementDetails" ADD CONSTRAINT "AgreementDetails_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgreementDetails" ADD CONSTRAINT "AgreementDetails_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
