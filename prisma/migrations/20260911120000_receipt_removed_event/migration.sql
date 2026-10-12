-- An utlägg can now hold more than one document (see the Receipt model's
-- comment): uploading appends instead of replacing, so removing the one that
-- turned out to be wrong, or a duplicate, needs its own event.

-- AlterEnum
ALTER TYPE "ExpenseEventType" ADD VALUE 'RECEIPT_REMOVED';
