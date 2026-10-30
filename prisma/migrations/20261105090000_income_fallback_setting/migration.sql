-- The reserv for unmatched sales moves from a flag on one product prefix to an
-- explicit setting: a verksamhet and an account. The flag was never read by the
-- routing (intakt hard-coded the prefix "sk"), and the app now routes itself.

ALTER TABLE "BookkeepingSettings"
  ADD COLUMN "incomeFallbackIncomeId" TEXT,
  ADD COLUMN "incomeFallbackAccount" TEXT;

ALTER TABLE "BookkeepingSettings" ADD CONSTRAINT "BookkeepingSettings_incomeFallbackIncomeId_fkey" FOREIGN KEY ("incomeFallbackIncomeId") REFERENCES "ResultUnitIncome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Whatever was marked as the reserv becomes the setting, so nothing has to be
-- chosen again. The prefix itself stays, as an ordinary prefix.
INSERT INTO "BookkeepingSettings" ("id", "incomeFallbackIncomeId", "incomeFallbackAccount", "updatedAt")
SELECT 'singleton', "incomeId", "account", NOW()
FROM "IncomeProductPrefix"
WHERE "isFallback"
ON CONFLICT ("id") DO UPDATE SET
  "incomeFallbackIncomeId" = EXCLUDED."incomeFallbackIncomeId",
  "incomeFallbackAccount" = EXCLUDED."incomeFallbackAccount";

DROP INDEX "IncomeProductPrefix_single_fallback";
ALTER TABLE "IncomeProductPrefix" DROP COLUMN "isFallback";
