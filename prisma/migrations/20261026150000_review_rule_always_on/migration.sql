-- The two-person rule on bokföring stops being a setting. Whoever konterade an
-- utlägg does not bokföra it, always. The roles holding REVIEW_OWN_BOOKING are
-- the only exception, and those are chosen in Inställningar → Roller.

-- AlterTable
ALTER TABLE "BookkeepingSettings" DROP COLUMN "requireSeparateReviewer";
