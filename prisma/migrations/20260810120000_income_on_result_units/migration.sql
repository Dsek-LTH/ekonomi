-- Verksamheten blir en: IncomeCommittee blir resultatenhetens intäktsprofil.
--
-- The section's verksamheter were listed twice: once as ResultUnit (who
-- attests, which cost centres are theirs) and once as IncomeCommittee (what the
-- intäktsräkning says, which products route where) on two settings screens,
-- with nothing checking that the two agreed. Sexmästeriet was two rows in two
-- tables that happened to share a name.
--
-- So the committee becomes the income *half* of a result unit: same table,
-- renamed and given a resultUnitId. Every committee keeps its id, its key and
-- its rows, which is what keeps the 130 reports and 18 prefixes pointing at the
-- right things, and keeps intakt's contract untouched, since the key it groups
-- reports by is carried over unchanged.
--
-- Committees whose name matches an existing result unit are joined to it. The
-- rest get a result unit created for them, with no cost-centre prefixes and no
-- owners: they take money in but own no cost centres and confer no attest
-- authority, which is exactly what they did before this migration.

-- ── The committee becomes the profile ─────────────────────────────

ALTER TABLE "IncomeCommittee" RENAME TO "ResultUnitIncome";

ALTER TABLE "ResultUnitIncome" RENAME CONSTRAINT "IncomeCommittee_pkey" TO "ResultUnitIncome_pkey";
ALTER TABLE "ResultUnitIncome"
  RENAME CONSTRAINT "IncomeCommittee_defaultCostCenterId_fkey" TO "ResultUnitIncome_defaultCostCenterId_fkey";
ALTER INDEX "IncomeCommittee_key_key" RENAME TO "ResultUnitIncome_key_key";

ALTER TABLE "ResultUnitIncome" ADD COLUMN "resultUnitId" TEXT;

-- Same name, same thing. Case-insensitive because these were typed on two
-- screens by two people; trimmed for the same reason.
UPDATE "ResultUnitIncome" i
   SET "resultUnitId" = u."id"
  FROM "ResultUnit" u
 WHERE lower(btrim(u."name")) = lower(btrim(i."properName"));

-- A verksamhet with no result unit gets one. gen_random_uuid() rather than a
-- cuid: ids here are opaque strings and nothing parses them.
INSERT INTO "ResultUnit" ("id", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, i."properName", now(), now()
  FROM "ResultUnitIncome" i
 WHERE i."resultUnitId" IS NULL;

UPDATE "ResultUnitIncome" i
   SET "resultUnitId" = u."id"
  FROM "ResultUnit" u
 WHERE i."resultUnitId" IS NULL
   AND u."name" = i."properName";

ALTER TABLE "ResultUnitIncome" ALTER COLUMN "resultUnitId" SET NOT NULL;

CREATE UNIQUE INDEX "ResultUnitIncome_resultUnitId_key" ON "ResultUnitIncome"("resultUnitId");

ALTER TABLE "ResultUnitIncome"
  ADD CONSTRAINT "ResultUnitIncome_resultUnitId_fkey"
  FOREIGN KEY ("resultUnitId") REFERENCES "ResultUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- properName is now an override, not a duplicate: null means "the unit's own
-- name", which after the join above is true of every row that matched and every
-- row we just created a unit for.
ALTER TABLE "ResultUnitIncome" ALTER COLUMN "properName" DROP NOT NULL;

UPDATE "ResultUnitIncome" i
   SET "properName" = NULL
  FROM "ResultUnit" u
 WHERE u."id" = i."resultUnitId"
   AND lower(btrim(u."name")) = lower(btrim(i."properName"));

-- ── The prefixes follow their profile ─────────────────────────────

ALTER TABLE "IncomeProductPrefix" RENAME COLUMN "committeeId" TO "incomeId";
ALTER TABLE "IncomeProductPrefix"
  RENAME CONSTRAINT "IncomeProductPrefix_committeeId_fkey" TO "IncomeProductPrefix_incomeId_fkey";
ALTER INDEX "IncomeProductPrefix_committeeId_idx" RENAME TO "IncomeProductPrefix_incomeId_idx";

-- ── The reports point at the unit ─────────────────────────────────
--
-- The unit, not the profile: whose takings these were is a fact about the
-- section, and it has to survive someone deciding the unit no longer sells
-- anything and deleting its income settings.

ALTER TABLE "IncomeReport" ADD COLUMN "resultUnitId" TEXT;

UPDATE "IncomeReport" r
   SET "resultUnitId" = i."resultUnitId"
  FROM "ResultUnitIncome" i
 WHERE r."committeeId" = i."id";

ALTER TABLE "IncomeReport" DROP CONSTRAINT "IncomeReport_committeeId_fkey";
DROP INDEX "IncomeReport_source_committeeId_date_idx";
DROP INDEX "IncomeReport_booked_once";
ALTER TABLE "IncomeReport" DROP COLUMN "committeeId";

ALTER TABLE "IncomeReport"
  ADD CONSTRAINT "IncomeReport_resultUnitId_fkey"
  FOREIGN KEY ("resultUnitId") REFERENCES "ResultUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "IncomeReport_source_resultUnitId_date_idx"
  ON "IncomeReport" ("source", "resultUnitId", "date");

-- The same takings must not be booked twice: unchanged in meaning, rebuilt on
-- the new column. Partial, because re-importing a range is normal and must stay
-- possible; the uniqueness applies only once a report has actually been booked.
CREATE UNIQUE INDEX "IncomeReport_booked_once"
  ON "IncomeReport" ("source", "resultUnitId", "date")
  WHERE "status" IN ('BOOKED', 'EXPORTED');
