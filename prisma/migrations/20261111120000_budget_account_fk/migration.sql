-- A budget account's name now comes from the chart of accounts. Refuse to run while a
-- budget account names a number the chart lacks: sync the chart, or fix the budget, first.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(DISTINCT ba."accountCode", ', ') INTO missing
  FROM "BudgetAccount" ba
  LEFT JOIN "Account" a ON a."number" = ba."accountCode"
  WHERE a."number" IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'BudgetAccount codes missing from Account: %', missing;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "BudgetAccount" DROP COLUMN "accountName";

-- AddForeignKey
ALTER TABLE "BudgetAccount" ADD CONSTRAINT "BudgetAccount_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "Account"("number") ON DELETE RESTRICT ON UPDATE CASCADE;
