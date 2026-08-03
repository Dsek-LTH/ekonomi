-- Collapse BudgetRevision into Budget: every revision becomes a budget of its
-- own, carrying its own copy of the year it used to share with its siblings.
--
-- Each revision keeps its id, so every link into it (its URL, its cost centres,
-- its variables) still lands where it did — only what it hangs off changes.
--
-- Order matters throughout: the cost centres and variables must be repointed at
-- their new budget BEFORE the old container rows are deleted. Deleting a
-- container first cascades through the revisions still hanging off it and takes
-- every sheet, account and row with them.

-- 1. Budget takes over what a revision carried.
ALTER TABLE "Budget" ADD COLUMN "name" TEXT;
ALTER TABLE "Budget" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Budget" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "Budget" ADD COLUMN "lockedById" TEXT;

-- 2. One budget per revision, inheriting the year from the budget it sat under.
--    The revision's id is kept, which is what makes step 3 a rename.
INSERT INTO "Budget" ("id", "year", "createdAt", "name", "createdById", "lockedAt", "lockedById")
SELECT r."id", b."year", r."createdAt", r."name", r."createdById", r."lockedAt", r."lockedById"
  FROM "BudgetRevision" r
  JOIN "Budget" b ON b."id" = r."budgetId";

-- 3. Variables and cost centres already hold a revision id, which is now also a
--    budget id — so the column is renamed and its foreign key re-aimed, rather
--    than the rows being rewritten.
ALTER TABLE "BudgetVariable" DROP CONSTRAINT "BudgetVariable_revisionId_fkey";
ALTER TABLE "BudgetCostCenter" DROP CONSTRAINT "BudgetCostCenter_revisionId_fkey";

ALTER TABLE "BudgetVariable" RENAME COLUMN "revisionId" TO "budgetId";
ALTER TABLE "BudgetCostCenter" RENAME COLUMN "revisionId" TO "budgetId";

ALTER INDEX "BudgetVariable_revisionId_idx" RENAME TO "BudgetVariable_budgetId_idx";
ALTER INDEX "BudgetVariable_revisionId_name_key" RENAME TO "BudgetVariable_budgetId_name_key";
ALTER INDEX "BudgetCostCenter_revisionId_idx" RENAME TO "BudgetCostCenter_budgetId_idx";
ALTER INDEX "BudgetCostCenter_revisionId_costCenterId_key" RENAME TO "BudgetCostCenter_budgetId_costCenterId_key";

ALTER TABLE "BudgetVariable" ADD CONSTRAINT "BudgetVariable_budgetId_fkey"
  FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetCostCenter" ADD CONSTRAINT "BudgetCostCenter_budgetId_fkey"
  FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. What the grouping made possible, and what nothing uses.
--    `baselineRevisionId` marked the adopted revision of a year; the ledger
--    report now falls back to the locked budget of that year instead.
--    BudgetColumn was never read: the extra columns are the fixed x1…x6 keys in
--    lib/budget/grid.ts.
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_baselineRevisionId_fkey";
ALTER TABLE "Budget" DROP COLUMN "baselineRevisionId";
DROP TABLE "BudgetColumn";
DROP TYPE "BudgetColumnKind";

-- 5. Nothing points at a revision any more.
DROP TABLE "BudgetRevision";

-- 6. The old rows were containers and nothing else; the revisions are the
--    budgets now. `name IS NULL` is exactly the set of pre-migration rows, and
--    with the revisions gone there is nothing left to cascade into.
DELETE FROM "Budget" WHERE "name" IS NULL;

ALTER TABLE "Budget" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "Budget" ALTER COLUMN "createdById" SET NOT NULL;

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_lockedById_fkey"
  FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
