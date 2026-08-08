-- Drop the REJECTED status, which said the same thing as CHANGES_REQUESTED.
--
-- It was unreachable from the app — nothing has written it since the attest
-- flow was built — but it stayed in the enum for historical rows, and the cost
-- of that was paid by every query written since: the status tabs had to map
-- CHANGES_REQUESTED onto two values, the dashboard's "waiting on you" filter
-- had to list both, and the read mapper had to translate one into the other on
-- the way to the interface. Three separate places, each of which had to
-- remember, and a fourth waiting to be written by someone who didn't.
--
-- The rows come first so the type change cannot fail on them. Postgres has no
-- "drop a value from an enum", hence the swap: build the new type, move the
-- column across, drop the old one. Both are wrapped in their own transaction
-- because ALTER TYPE ... ADD/RENAME and the table rewrite cannot share one.
--
-- One-way. Anything that was REJECTED is CHANGES_REQUESTED afterwards, and the
-- distinction is not recoverable — which is the point, since to every reader
-- the two were the same state under two names.

-- Rows first: nothing can be left holding a value the new type has no room for.
UPDATE "Expense"      SET status = 'CHANGES_REQUESTED' WHERE status = 'REJECTED';
UPDATE "ExpenseEvent" SET type   = 'CHANGES_REQUESTED' WHERE type   = 'REJECTED';

-- AlterEnum
BEGIN;
CREATE TYPE "ExpenseEventType_new" AS ENUM ('CREATED', 'EDITED', 'RECEIPT_UPLOADED', 'MATCHED', 'UNMATCHED', 'SUBMITTED', 'CHANGES_REQUESTED', 'COST_CENTER_APPROVED', 'ATTEST_WITHDRAWN', 'APPROVED', 'BOOKED', 'EXPORTED', 'EXPORT_REVERTED');
ALTER TABLE "ExpenseEvent" ALTER COLUMN "type" TYPE "ExpenseEventType_new" USING ("type"::text::"ExpenseEventType_new");
ALTER TYPE "ExpenseEventType" RENAME TO "ExpenseEventType_old";
ALTER TYPE "ExpenseEventType_new" RENAME TO "ExpenseEventType";
DROP TYPE "public"."ExpenseEventType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ExpenseStatus_new" AS ENUM ('DRAFT', 'PENDING_MATCH', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'BOOKED', 'EXPORTED');
ALTER TABLE "public"."Expense" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Expense" ALTER COLUMN "status" TYPE "ExpenseStatus_new" USING ("status"::text::"ExpenseStatus_new");
ALTER TYPE "ExpenseStatus" RENAME TO "ExpenseStatus_old";
ALTER TYPE "ExpenseStatus_new" RENAME TO "ExpenseStatus";
DROP TYPE "public"."ExpenseStatus_old";
ALTER TABLE "Expense" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;
