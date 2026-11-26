-- A budget comment can now sit on a line or on one cell of a line, not only on an account,
-- like a note in a spreadsheet. Existing comments all have an account and stay where they are.
ALTER TABLE "BudgetComment" ADD COLUMN "field" TEXT,
ADD COLUMN "lineItemId" TEXT,
ALTER COLUMN "accountId" DROP NOT NULL;

CREATE INDEX "BudgetComment_lineItemId_idx" ON "BudgetComment"("lineItemId");

ALTER TABLE "BudgetComment" ADD CONSTRAINT "BudgetComment_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "BudgetLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one place: an account, or a line. A cell is a line plus the cell's key, so an
-- account comment has no field.
ALTER TABLE "BudgetComment" ADD CONSTRAINT "BudgetComment_one_target"
  CHECK ((("accountId" IS NULL) <> ("lineItemId" IS NULL)) AND ("field" IS NULL OR "lineItemId" IS NOT NULL));
