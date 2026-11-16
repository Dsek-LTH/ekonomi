-- Two stocks instead of one (docs/stock.md). This migration only touches enums.
-- The tables, and the rows that use the new values, are in the next one:
-- Postgres will not let a transaction use an enum value added by that same
-- transaction.

-- The two stock capabilities were the alcohol stock's all along. Renamed in
-- place, so every RoleCapability row follows.
ALTER TYPE "Capability" RENAME VALUE 'STOCK_VIEW' TO 'ALCOHOL_STOCK_VIEW';
ALTER TYPE "Capability" RENAME VALUE 'STOCK_MANAGE' TO 'ALCOHOL_STOCK_MANAGE';

ALTER TYPE "Capability" ADD VALUE 'CAFE_STOCK_VIEW';
ALTER TYPE "Capability" ADD VALUE 'CAFE_STOCK_REFILL';
ALTER TYPE "Capability" ADD VALUE 'CAFE_STOCK_MANAGE';
ALTER TYPE "Capability" ADD VALUE 'BOARD_TAB';

ALTER TYPE "Role" ADD VALUE 'CAFE_STOCKARE';
ALTER TYPE "Role" ADD VALUE 'STYRELSE';

ALTER TYPE "StockEntryKind" ADD VALUE 'ISSUE';
ALTER TYPE "StockEntryKind" ADD VALUE 'WITHDRAWAL';

CREATE TYPE "StockPurchaseMode" AS ENUM ('CAPITALISED', 'EXPENSED');
