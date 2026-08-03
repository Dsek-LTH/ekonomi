-- Opening/closing balances per account per financial year, mirrored from the
-- SIE #IB/#UB records. The balance report needs these: balance-sheet accounts
-- carry history from earlier years, so a year's vouchers alone only give the
-- movement, not the balance itself.
--
-- costCenterCode "" is the account-level total (#IB/#UB); a non-empty code is
-- the optional per-object breakdown (#OIB/#OUB). Empty string rather than NULL
-- so it can take part in the primary key.
CREATE TABLE "LedgerAccountBalance" (
    "financialYear" INTEGER NOT NULL,
    "account" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "costCenterCode" TEXT NOT NULL DEFAULT '',
    "opening" INTEGER NOT NULL,
    "closing" INTEGER NOT NULL,

    CONSTRAINT "LedgerAccountBalance_pkey" PRIMARY KEY ("financialYear", "account", "costCenterCode")
);

CREATE INDEX "LedgerAccountBalance_account_idx" ON "LedgerAccountBalance"("account");

ALTER TABLE "LedgerAccountBalance"
    ADD CONSTRAINT "LedgerAccountBalance_financialYear_fkey"
    FOREIGN KEY ("financialYear") REFERENCES "FortnoxFinancialYear"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
