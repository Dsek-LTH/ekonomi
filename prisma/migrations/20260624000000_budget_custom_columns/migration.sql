-- Custom budget columns (shared across a budget's revisions) + per-line values.
CREATE TYPE "BudgetColumnKind" AS ENUM ('TEXT', 'NUMBER');

CREATE TABLE "BudgetColumn" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BudgetColumnKind" NOT NULL DEFAULT 'TEXT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BudgetColumn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BudgetColumn_budgetId_idx" ON "BudgetColumn"("budgetId");

ALTER TABLE "BudgetColumn"
    ADD CONSTRAINT "BudgetColumn_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BudgetLineItem" ADD COLUMN "values" JSONB NOT NULL DEFAULT '{}';
