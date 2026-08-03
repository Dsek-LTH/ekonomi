-- Budget ↔ spreadsheet parity:
--   committee grouping on cost centers, income/cost classification on budget
--   accounts, antal × á-pris on line items, and a baseline-revision pointer
--   for the side-by-side "REV vs antagen" comparison columns.

CREATE TYPE "BudgetAccountKind" AS ENUM ('INCOME', 'COST');

ALTER TABLE "CostCenter" ADD COLUMN "committee" TEXT;

ALTER TABLE "Budget" ADD COLUMN "baselineRevisionId" TEXT;
ALTER TABLE "Budget"
    ADD CONSTRAINT "Budget_baselineRevisionId_fkey"
    FOREIGN KEY ("baselineRevisionId") REFERENCES "BudgetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BudgetAccount" ADD COLUMN "kindOverride" "BudgetAccountKind";

ALTER TABLE "BudgetLineItem" ADD COLUMN "quantity" TEXT;
ALTER TABLE "BudgetLineItem" ADD COLUMN "unitPrice" TEXT;
