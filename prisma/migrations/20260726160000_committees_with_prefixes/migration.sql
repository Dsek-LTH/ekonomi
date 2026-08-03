-- Committees become a first-class table, and which cost centres belong to one
-- is derived from prefixes instead of the free-text CostCenter.committee column
-- (which nothing in the app could actually write).

CREATE TABLE "Committee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Committee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Committee_name_key" ON "Committee"("name");

CREATE TABLE "CommitteePrefix" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitteePrefix_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommitteePrefix_value_key" ON "CommitteePrefix"("value");
CREATE INDEX "CommitteePrefix_committeeId_idx" ON "CommitteePrefix"("committeeId");

ALTER TABLE "CommitteePrefix"
    ADD CONSTRAINT "CommitteePrefix_committeeId_fkey"
    FOREIGN KEY ("committeeId") REFERENCES "Committee"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Carry existing data over ────────────────────────────────────────
-- One Committee per distinct label, taken from both the cost centres and the
-- masterships (a committee may exist only as a mastership).
INSERT INTO "Committee" ("id", "name", "updatedAt")
SELECT gen_random_uuid()::text, label, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT "committee" AS label FROM "CostCenter" WHERE "committee" IS NOT NULL
    UNION
    SELECT DISTINCT "committee" AS label FROM "CommitteeMastership"
) AS labels;

-- Every cost centre that carried a label gets its full code as that committee's
-- prefix. Membership is therefore identical to before this migration: the code
-- matches itself and nothing else. Real prefixes ("SKT") are entered afterwards.
INSERT INTO "CommitteePrefix" ("id", "committeeId", "value")
SELECT gen_random_uuid()::text, c."id", upper(cc."code")
FROM "CostCenter" cc
JOIN "Committee" c ON c."name" = cc."committee"
WHERE cc."committee" IS NOT NULL
ON CONFLICT ("value") DO NOTHING;

-- ── Masterships: string label → foreign key ─────────────────────────
ALTER TABLE "CommitteeMastership" ADD COLUMN "committeeId" TEXT;

UPDATE "CommitteeMastership" m
SET "committeeId" = c."id"
FROM "Committee" c
WHERE c."name" = m."committee";

-- Any mastership whose label somehow found no committee would violate the NOT
-- NULL below; there can be none, since committees were built from these labels.
ALTER TABLE "CommitteeMastership" ALTER COLUMN "committeeId" SET NOT NULL;

DROP INDEX IF EXISTS "CommitteeMastership_committee_idx";
ALTER TABLE "CommitteeMastership" DROP CONSTRAINT IF EXISTS "CommitteeMastership_userId_committee_key";
ALTER TABLE "CommitteeMastership" DROP COLUMN "committee";

CREATE UNIQUE INDEX "CommitteeMastership_userId_committeeId_key" ON "CommitteeMastership"("userId", "committeeId");
CREATE INDEX "CommitteeMastership_committeeId_idx" ON "CommitteeMastership"("committeeId");

ALTER TABLE "CommitteeMastership"
    ADD CONSTRAINT "CommitteeMastership_committeeId_fkey"
    FOREIGN KEY ("committeeId") REFERENCES "Committee"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The column the prefixes replace ─────────────────────────────────
ALTER TABLE "CostCenter" DROP COLUMN "committee";
