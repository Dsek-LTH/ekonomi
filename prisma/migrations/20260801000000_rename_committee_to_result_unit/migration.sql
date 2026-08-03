-- Utskott blir resultatenhet, utskottsmästare blir resultatansvarig.
--
-- A pure rename: the model is untouched. A result unit still owns cost-centre
-- prefixes and still decides who attests, and a person may still answer for
-- several units. Only the words change — so everything here renames in place
-- and not one row is rewritten.

-- ── The role ──────────────────────────────────────────────────────
-- RENAME VALUE rewrites the label without touching the User.roles arrays that
-- point at it, so nobody loses their attest authority mid-migration.
ALTER TYPE "Role" RENAME VALUE 'UTSKOTTSMASTARE' TO 'RESULTATANSVARIG';

-- ── Tables ────────────────────────────────────────────────────────
ALTER TABLE "Committee" RENAME TO "ResultUnit";
ALTER TABLE "CommitteePrefix" RENAME TO "ResultUnitPrefix";
ALTER TABLE "CommitteeMastership" RENAME TO "ResultUnitOwner";

-- ── Columns ───────────────────────────────────────────────────────
ALTER TABLE "ResultUnitPrefix" RENAME COLUMN "committeeId" TO "resultUnitId";
ALTER TABLE "ResultUnitOwner" RENAME COLUMN "committeeId" TO "resultUnitId";

-- ── Constraints ───────────────────────────────────────────────────
ALTER TABLE "ResultUnit" RENAME CONSTRAINT "Committee_pkey" TO "ResultUnit_pkey";
ALTER TABLE "ResultUnitPrefix" RENAME CONSTRAINT "CommitteePrefix_pkey" TO "ResultUnitPrefix_pkey";
ALTER TABLE "ResultUnitOwner" RENAME CONSTRAINT "CommitteeMastership_pkey" TO "ResultUnitOwner_pkey";

ALTER TABLE "ResultUnitPrefix"
    RENAME CONSTRAINT "CommitteePrefix_committeeId_fkey" TO "ResultUnitPrefix_resultUnitId_fkey";
ALTER TABLE "ResultUnitOwner"
    RENAME CONSTRAINT "CommitteeMastership_committeeId_fkey" TO "ResultUnitOwner_resultUnitId_fkey";
ALTER TABLE "ResultUnitOwner"
    RENAME CONSTRAINT "CommitteeMastership_userId_fkey" TO "ResultUnitOwner_userId_fkey";

-- ── Indexes ───────────────────────────────────────────────────────
ALTER INDEX "Committee_name_key" RENAME TO "ResultUnit_name_key";
ALTER INDEX "CommitteePrefix_value_key" RENAME TO "ResultUnitPrefix_value_key";
ALTER INDEX "CommitteePrefix_committeeId_idx" RENAME TO "ResultUnitPrefix_resultUnitId_idx";
ALTER INDEX "CommitteeMastership_userId_committeeId_key" RENAME TO "ResultUnitOwner_userId_resultUnitId_key";
ALTER INDEX "CommitteeMastership_committeeId_idx" RENAME TO "ResultUnitOwner_resultUnitId_idx";
