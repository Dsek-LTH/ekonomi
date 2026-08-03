-- A year can hold several budgets (the ordinary one plus e.g. an extra budget
-- presented at VTM), told apart by name. Drop the one-per-year constraint and
-- keep a plain index, since the list is grouped and ordered by year.
DROP INDEX "Budget_year_key";
CREATE INDEX "Budget_year_idx" ON "Budget"("year");
