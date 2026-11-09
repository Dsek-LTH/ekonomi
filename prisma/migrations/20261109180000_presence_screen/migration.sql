-- Presence on the review of a konterat utlägg as well as on its booking screen,
-- so two bookkeepers do not granska the same utlägg without knowing it.

-- CreateEnum
CREATE TYPE "PresenceScreen" AS ENUM ('BOOK', 'REVIEW');

-- AlterTable
ALTER TABLE "ExpensePresence" ADD COLUMN "screen" "PresenceScreen" NOT NULL DEFAULT 'BOOK';
ALTER TABLE "ExpensePresence" DROP CONSTRAINT "ExpensePresence_pkey",
ADD CONSTRAINT "ExpensePresence_pkey" PRIMARY KEY ("expenseId", "userId", "screen");
