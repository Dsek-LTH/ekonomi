-- Budget system: Budget, BudgetRevision, BudgetVariable,
-- BudgetCostCenter, BudgetAccount, BudgetLineItem, BudgetComment

CREATE TABLE "Budget" (
    "id"        TEXT NOT NULL,
    "year"      INTEGER NOT NULL,
    "name"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Budget_year_key" ON "Budget"("year");

CREATE TABLE "BudgetRevision" (
    "id"           TEXT NOT NULL,
    "budgetId"     TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "createdById"  TEXT NOT NULL,
    "clonedFromId" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BudgetRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BudgetRevision_budgetId_idx" ON "BudgetRevision"("budgetId");

CREATE TABLE "BudgetVariable" (
    "id"         TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "sortOrder"  INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BudgetVariable_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetVariable_revisionId_name_key" ON "BudgetVariable"("revisionId", "name");
CREATE INDEX "BudgetVariable_revisionId_idx" ON "BudgetVariable"("revisionId");

CREATE TABLE "BudgetCostCenter" (
    "id"           TEXT NOT NULL,
    "revisionId"   TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "sortOrder"    INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BudgetCostCenter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetCostCenter_revisionId_costCenterId_key" ON "BudgetCostCenter"("revisionId", "costCenterId");
CREATE INDEX "BudgetCostCenter_revisionId_idx" ON "BudgetCostCenter"("revisionId");

CREATE TABLE "BudgetAccount" (
    "id"                 TEXT NOT NULL,
    "budgetCostCenterId" TEXT NOT NULL,
    "accountCode"        TEXT NOT NULL,
    "accountName"        TEXT NOT NULL,
    "sortOrder"          INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BudgetAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetAccount_budgetCostCenterId_accountCode_key" ON "BudgetAccount"("budgetCostCenterId", "accountCode");
CREATE INDEX "BudgetAccount_budgetCostCenterId_idx" ON "BudgetAccount"("budgetCostCenterId");

CREATE TABLE "BudgetLineItem" (
    "id"          TEXT NOT NULL,
    "accountId"   TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expression"  TEXT NOT NULL,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BudgetLineItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BudgetLineItem_accountId_idx" ON "BudgetLineItem"("accountId");

CREATE TABLE "BudgetComment" (
    "id"        TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "authorId"  TEXT NOT NULL,
    "body"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BudgetComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BudgetComment_accountId_idx" ON "BudgetComment"("accountId");

-- Foreign keys
ALTER TABLE "BudgetRevision"
    ADD CONSTRAINT "BudgetRevision_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetRevision"
    ADD CONSTRAINT "BudgetRevision_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetRevision"
    ADD CONSTRAINT "BudgetRevision_clonedFromId_fkey"
    FOREIGN KEY ("clonedFromId") REFERENCES "BudgetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BudgetVariable"
    ADD CONSTRAINT "BudgetVariable_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "BudgetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BudgetCostCenter"
    ADD CONSTRAINT "BudgetCostCenter_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "BudgetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetCostCenter"
    ADD CONSTRAINT "BudgetCostCenter_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BudgetAccount"
    ADD CONSTRAINT "BudgetAccount_budgetCostCenterId_fkey"
    FOREIGN KEY ("budgetCostCenterId") REFERENCES "BudgetCostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BudgetLineItem"
    ADD CONSTRAINT "BudgetLineItem_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "BudgetAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BudgetComment"
    ADD CONSTRAINT "BudgetComment_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "BudgetAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetComment"
    ADD CONSTRAINT "BudgetComment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
