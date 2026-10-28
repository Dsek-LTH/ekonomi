-- A cost centre's short name, for where its result unit is already named
-- above it. Optional and empty for every row to begin with: nothing is
-- shortened until somebody chooses a name.
ALTER TABLE "CostCenter" ADD COLUMN "shortName" TEXT;
