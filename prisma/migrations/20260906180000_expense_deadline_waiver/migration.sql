-- Dispens från redovisningsfristen: one late eget utlägg let past the 60-day
-- filing deadline, per claim, with a reason.
--
-- Three nullable columns and a capability, rather than making the deadline
-- itself configurable. Moving the deadline would change the rule for everybody,
-- retroactively, and leave nobody able to say afterwards which decision covered
-- which claim. These columns say which claim, who allowed it and why, and the
-- answer survives whatever the deadline is later set to.

-- AlterEnum
ALTER TYPE "Capability" ADD VALUE 'EXPENSE_DEADLINE_WAIVE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExpenseEventType" ADD VALUE 'DEADLINE_WAIVED';
ALTER TYPE "ExpenseEventType" ADD VALUE 'DEADLINE_WAIVER_REVOKED';

-- AlterTable
ALTER TABLE "Expense"
  ADD COLUMN "deadlineWaivedById"   TEXT,
  ADD COLUMN "deadlineWaivedAt"     TIMESTAMP(3),
  ADD COLUMN "deadlineWaiverReason" TEXT;

-- AddForeignKey
ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_deadlineWaivedById_fkey"
  FOREIGN KEY ("deadlineWaivedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
