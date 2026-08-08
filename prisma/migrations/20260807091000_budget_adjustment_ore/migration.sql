-- BudgetAdjustment.amount: kronor as a Float → öre as an Int.
--
-- This column was the last place in the database holding money as a floating
-- point number, against the rule stated at the top of schema.prisma. It is a
-- *decided* amount — a treasurer's budgetavsteg or budgetförflyttning — and a
-- förflyttning is required to net to exactly zero, which is not a question a
-- float can answer: the check in lib/budget/changes.ts carried a half-öre
-- epsilon precisely because two amounts that ought to cancel could miss.
--
-- USING rounds rather than truncates, so 12.005 kr becomes 1201 öre and not
-- 1200. Existing values were typed to at most two decimals (the belopp field
-- accepts no more), so in practice this is exact and the rounding only guards
-- against a value that got there another way.
ALTER TABLE "BudgetAdjustment"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100)::INTEGER;
