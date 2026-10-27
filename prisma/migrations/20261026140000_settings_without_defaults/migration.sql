-- Settings are decisions, and no setting has a default any more. A column that
-- nobody has chosen is null, and whatever needs it refuses until somebody
-- does, rather than quietly running on a value nobody picked.
--
-- What is already stored stays as it is. The one exception is the two-person
-- rule on bokföring: it was added a few minutes before this with a default of
-- true that nobody chose, so it goes back to unset and has to be decided.

-- AlterTable
ALTER TABLE "BookkeepingSettings"
  ALTER COLUMN "bankAccount" DROP DEFAULT,
  ALTER COLUMN "bankAccount" DROP NOT NULL,
  ALTER COLUMN "memberDebtAccount" DROP DEFAULT,
  ALTER COLUMN "memberDebtAccount" DROP NOT NULL,
  ALTER COLUMN "zettleClearingAccount" DROP DEFAULT,
  ALTER COLUMN "zettleClearingAccount" DROP NOT NULL,
  ALTER COLUMN "swishClearingAccount" DROP DEFAULT,
  ALTER COLUMN "swishClearingAccount" DROP NOT NULL,
  ALTER COLUMN "zettleFeeAccount" DROP DEFAULT,
  ALTER COLUMN "zettleFeeAccount" DROP NOT NULL,
  ALTER COLUMN "requireSeparateReviewer" DROP DEFAULT,
  ALTER COLUMN "requireSeparateReviewer" DROP NOT NULL;

UPDATE "BookkeepingSettings" SET "requireSeparateReviewer" = NULL;

-- AlterTable
ALTER TABLE "FortnoxConnection"
  ALTER COLUMN "voucherSeries" DROP DEFAULT,
  ALTER COLUMN "voucherSeries" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StockSettings"
  ALTER COLUMN "expiryLeadDays" DROP DEFAULT,
  ALTER COLUMN "expiryLeadDays" DROP NOT NULL;
