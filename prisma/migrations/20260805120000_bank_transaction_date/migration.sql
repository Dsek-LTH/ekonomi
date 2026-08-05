-- A bank row is dated by Transdag, not Bokfdag.
--
-- The CSV carries both: Bokfdag is the day the bank settled the row, Transdag
-- the day the card was actually used. For a card purchase they differ by a day
-- or three, and it is Transdag that matches the date printed on the receipt the
-- member hands in — so it is Transdag the matching, the date filter and the
-- purchase date prefilled on a new utlägg should all speak in.
--
-- Rows imported before this only ever stored Bokfdag; renaming the column does
-- not reinterpret them. They keep their settlement date until re-imported, and
-- a re-import is a no-op (importHash is unchanged — it always hashed both
-- dates), so correcting an old row means deleting it first. Not worth a
-- backfill: the file is the source of truth and old rows are already matched.
ALTER TABLE "BankTransaction" RENAME COLUMN "bookedDate" TO "transactionDate";
ALTER INDEX "BankTransaction_bookedDate_idx" RENAME TO "BankTransaction_transactionDate_idx";
