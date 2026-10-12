-- An account is on the side its number puts it on.
--
-- BAS says which: 3xxx is income, 4xxx-8xxx is cost. `kindOverride` let a sheet
-- disagree, set by dragging an account card from Intäkter to Kostnader or back,
-- and a budget that files a cost account as income is a budget that will not
-- match the ledger it is held against. The ledger reports the account where its
-- number says, whatever the budget said about it.
--
-- Dropping the column takes the drag with it. That is the point of the change
-- rather than a casualty of it: the classification is not an opinion the sheet
-- gets to hold.
--
-- Existing overrides are discarded, not migrated. There is nowhere to put them:
-- the whole idea the column encoded is the one being removed, and an account
-- that was filed on the wrong side goes back to the right one. Any sheet that
-- used one will show that account under the other heading after this, with its
-- rows and its figures unchanged.
ALTER TABLE "BudgetAccount" DROP COLUMN "kindOverride";
DROP TYPE "BudgetAccountKind";
