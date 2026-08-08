-- Indexes for the list screens, which filter, sort and page in the database
-- (lib/data/expenses.ts, lib/data/bank.ts). Until now nothing backed the
-- orderings those issue: every page of 25 was a full sort of everything that
-- matched, and the paging read the whole set to discard most of it.
--
-- The three indexes dropped below are not lost, only widened — each is the
-- leading column of the composite that replaces it, so the filters they served
-- are still served, and now the ORDER BY after them is too.
--
-- Checked against 50 000 synthetic rows before committing (EXPLAIN ANALYZE, in
-- a rolled-back transaction):
--
--   default order, no filter       Index Scan Backward, 25 rows read
--   selective status + that order  Index Scan Backward, 25 rows read
--   submitter + that order         Index Scan Backward, 25 rows read
--   purchaseDate sort              Index Scan,          25 rows read
--   grossAmount sort, page 40      Index Scan Backward, 1025 rows read (OFFSET)
--   title sort (unindexed, meant)  Seq Scan + top-N heapsort over all 50 000
--
-- The last line is what all six looked like before this migration.
--
-- CREATE INDEX takes a write lock for the duration. On a section's table that
-- is milliseconds; if this ever runs against something large, CONCURRENTLY is
-- the escape, and it cannot run inside a migration transaction.

-- DropIndex
DROP INDEX "BankTransaction_transactionDate_idx";

-- DropIndex
DROP INDEX "Expense_status_idx";

-- DropIndex
DROP INDEX "Expense_submitterId_idx";

-- CreateIndex
CREATE INDEX "BankTransaction_transactionDate_id_idx" ON "BankTransaction"("transactionDate", "id");

-- CreateIndex
CREATE INDEX "BankTransaction_amount_id_idx" ON "BankTransaction"("amount", "id");

-- CreateIndex
CREATE INDEX "Expense_createdAt_id_idx" ON "Expense"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Expense_status_createdAt_id_idx" ON "Expense"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Expense_submitterId_createdAt_id_idx" ON "Expense"("submitterId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Expense_purchaseDate_id_idx" ON "Expense"("purchaseDate", "id");

-- CreateIndex
CREATE INDEX "Expense_grossAmount_id_idx" ON "Expense"("grossAmount", "id");

-- CreateIndex
CREATE INDEX "ExpenseCostAllocation_costCenterId_idx" ON "ExpenseCostAllocation"("costCenterId");
