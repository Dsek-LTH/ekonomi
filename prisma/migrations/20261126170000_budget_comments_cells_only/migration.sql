-- A line's comment always names its cell: comments on a whole row are dropped. Any made in
-- the short time they existed move to the row's Beskrivning cell rather than being lost.
UPDATE "BudgetComment" SET "field" = 'description' WHERE "lineItemId" IS NOT NULL AND "field" IS NULL;

ALTER TABLE "BudgetComment" DROP CONSTRAINT "BudgetComment_one_target";

-- Exactly one place: an account (its number, no field) or a line's cell (a field).
ALTER TABLE "BudgetComment" ADD CONSTRAINT "BudgetComment_one_target"
  CHECK ((("accountId" IS NULL) <> ("lineItemId" IS NULL)) AND (("lineItemId" IS NULL) = ("field" IS NULL)));
