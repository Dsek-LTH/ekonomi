-- An utlägg may split one cost centre over several rows, each with its own
-- amount and comment. The unique index refused the second row, and the save
-- failed as a bare database error. The plain index on "expenseId" still serves
-- lookups by utlägg.
DROP INDEX "ExpenseCostAllocation_expenseId_costCenterId_key";
