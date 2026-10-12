-- LedgerRow carries its voucher's financial year and date, so that a report can
-- be answered from this table's own indexes instead of joining every row to
-- LedgerVoucher to find out which year it is in. See LedgerRow in schema.prisma.
--
-- Written in three steps rather than the one Prisma generates: the columns are
-- NOT NULL, and any instance that has ever synced a ledger already has rows to
-- fill in. Added nullable, backfilled from the voucher each row hangs off, then
-- tightened.

-- 1. Add nullable, so existing rows survive the ALTER.
ALTER TABLE "LedgerRow" ADD COLUMN "financialYear" INTEGER,
                        ADD COLUMN "date" DATE;

-- 2. Backfill from the voucher. This is the same value the sync will write from
--    now on: the row is a line of that voucher, so it is in that voucher's year
--    and dated with it.
UPDATE "LedgerRow" r
   SET "financialYear" = v."financialYear",
       "date"          = v."date"
  FROM "LedgerVoucher" v
 WHERE r."voucherId" = v."id";

-- 3. Now that every row has both, require them.
ALTER TABLE "LedgerRow" ALTER COLUMN "financialYear" SET NOT NULL,
                        ALTER COLUMN "date" SET NOT NULL;

-- The replaced indexes: neither could be reached by a query that starts by
-- narrowing to a financial year, which all of them do.
DROP INDEX "LedgerRow_account_idx";
DROP INDEX "LedgerRow_costCenterCode_idx";

CREATE INDEX "LedgerRow_financialYear_date_idx" ON "LedgerRow"("financialYear", "date");
CREATE INDEX "LedgerRow_financialYear_account_idx" ON "LedgerRow"("financialYear", "account");
