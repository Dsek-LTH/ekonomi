-- The rendered utläggsräkning (the cover page) for a booked expense, stored in
-- object storage exactly as IncomeReport's intäktsräkning is. Nullable and with
-- no default: an utlägg has none until it is booked, and a reopen clears it.

ALTER TABLE "Expense" ADD COLUMN "documentKey" TEXT;
ALTER TABLE "Expense" ADD COLUMN "documentFilename" TEXT;
