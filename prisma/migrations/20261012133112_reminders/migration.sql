-- Reminders: somebody chasing an utlägg that is waiting on somebody else, by
-- mail, by hand. A capability to hold, a kind of mail that cannot be switched
-- off, and an event in the utlägg's history saying it was sent.
--
-- Who holds the capability is set in the next migration. Postgres will not let
-- a transaction use an enum value added by that same transaction.

-- AlterEnum
ALTER TYPE "Capability" ADD VALUE 'SEND_REMINDERS';

-- AlterEnum
ALTER TYPE "ExpenseEventType" ADD VALUE 'REMINDER_SENT';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'EXPENSE_REMINDER';
