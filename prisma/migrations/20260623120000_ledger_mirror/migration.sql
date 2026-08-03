-- Fortnox ledger mirror (read side): financial years + vouchers + rows.

CREATE TABLE "FortnoxFinancialYear" (
    "id" INTEGER NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    CONSTRAINT "FortnoxFinancialYear_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerVoucher" (
    "id" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerVoucher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerRow" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "costCenterCode" TEXT,
    "costCenterName" TEXT,
    "project" TEXT,
    "text" TEXT,
    "debit" INTEGER NOT NULL,
    "credit" INTEGER NOT NULL,
    CONSTRAINT "LedgerRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LedgerVoucher_financialYear_series_number_key" ON "LedgerVoucher"("financialYear", "series", "number");
CREATE INDEX "LedgerVoucher_date_idx" ON "LedgerVoucher"("date");
CREATE INDEX "LedgerRow_account_idx" ON "LedgerRow"("account");
CREATE INDEX "LedgerRow_costCenterCode_idx" ON "LedgerRow"("costCenterCode");
CREATE INDEX "LedgerRow_voucherId_idx" ON "LedgerRow"("voucherId");

ALTER TABLE "LedgerVoucher" ADD CONSTRAINT "LedgerVoucher_financialYear_fkey" FOREIGN KEY ("financialYear") REFERENCES "FortnoxFinancialYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerRow" ADD CONSTRAINT "LedgerRow_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "LedgerVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
