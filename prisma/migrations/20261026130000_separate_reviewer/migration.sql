-- The two-person rule on bokföring: the utlägg is sent to Fortnox by somebody
-- other than whoever konterade it. A setting, on by default, and a capability
-- for whoever is exempt from it.

-- AlterEnum
ALTER TYPE "Capability" ADD VALUE 'REVIEW_OWN_BOOKING';

-- AlterTable
ALTER TABLE "BookkeepingSettings" ADD COLUMN "requireSeparateReviewer" BOOLEAN NOT NULL DEFAULT true;
