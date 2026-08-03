-- A budget is just a year holding revisions; the revision name is what
-- identifies a budget in the UI ("Ursprunglig", "VTM-extra"), so Budget.name
-- carried nothing but a duplicate of the year.
ALTER TABLE "Budget" DROP COLUMN "name";
