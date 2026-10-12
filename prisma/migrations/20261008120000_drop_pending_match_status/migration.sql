-- Drop the PENDING_MATCH status, which nothing in the app ever wrote.
--
-- A card purchase without a bank match is created as DRAFT, and the rule that
-- it must be matched before it goes for attest is enforced on DRAFT by
-- submitBlocker. PENDING_MATCH only reached the database through the seed, but
-- it still showed up as an option in the status filter, as a tab, and as a
-- dashboard action that could never fire.
--
-- Any row holding it becomes DRAFT. The two were treated the same everywhere
-- (editable, submittable, waiting on the submitter), so nothing is lost.
-- Postgres has no "drop a value from an enum", hence the swap, as in
-- 20260807090000_drop_rejected_status.

-- Rows first: nothing can be left holding a value the new type has no room for.
UPDATE "Expense" SET status = 'DRAFT' WHERE status = 'PENDING_MATCH';

-- AlterEnum
BEGIN;
CREATE TYPE "ExpenseStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'BOOKED', 'EXPORTED');
ALTER TABLE "public"."Expense" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Expense" ALTER COLUMN "status" TYPE "ExpenseStatus_new" USING ("status"::text::"ExpenseStatus_new");
ALTER TYPE "ExpenseStatus" RENAME TO "ExpenseStatus_old";
ALTER TYPE "ExpenseStatus_new" RENAME TO "ExpenseStatus";
DROP TYPE "public"."ExpenseStatus_old";
ALTER TABLE "Expense" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;
