-- Two stocks, and a product type the accounts hang on (docs/stock.md).
--
-- Nothing here touches a StockEntry's quantities or values. Every existing
-- product and event becomes the alcohol stock's, and each product gets the
-- group its drink category names.

CREATE TABLE "Stock" (
    "id" TEXT NOT NULL,
    "purchaseMode" "StockPurchaseMode" NOT NULL,
    "consumptionCostCenterId" TEXT,
    "purchaseOffsetAccount" TEXT,
    "purchaseCostCenterId" TEXT,
    "lossCostCenterId" TEXT,
    "countDiffCostCenterId" TEXT,
    "boardCostAccount" TEXT,
    "boardCostCenterId" TEXT,
    "boardSalesAccount" TEXT,
    "boardSalesCostCenterId" TEXT,
    "voucherSeries" TEXT,
    "postingStartsOn" DATE,
    "expiryLeadDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockGroup" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "DrinkCategory",
    "stockAccount" TEXT,
    "consumptionAccount" TEXT,
    "lossAccount" TEXT,
    "countDiffAccount" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockGroup_pkey" PRIMARY KEY ("id")
);

-- The two stocks. Alcohol purchases are booked straight to a stock account,
-- café purchases are booked as a cost. The notice period for best-before
-- checks was section-wide and is the alcohol stock's from here on.
INSERT INTO "Stock" ("id", "purchaseMode", "expiryLeadDays", "updatedAt")
VALUES
  ('alcohol', 'CAPITALISED', (SELECT "expiryLeadDays" FROM "StockSettings" WHERE "id" = 'singleton'), CURRENT_TIMESTAMP),
  ('cafe', 'EXPENSED', NULL, CURRENT_TIMESTAMP);

-- One type per drink category in the alcohol stock, and the café's one.
-- Accounts are left for Inställningar.
INSERT INTO "StockGroup" ("id", "stockId", "name", "category", "sortOrder", "updatedAt")
VALUES
  ('stockgroup-ol', 'alcohol', 'Öl', 'OL', 0, CURRENT_TIMESTAMP),
  ('stockgroup-cider', 'alcohol', 'Cider', 'OVRIG_JASTDRYCK', 1, CURRENT_TIMESTAMP),
  ('stockgroup-vin', 'alcohol', 'Vin', 'VIN', 2, CURRENT_TIMESTAMP),
  ('stockgroup-sprit', 'alcohol', 'Sprit', 'SPRITDRYCK', 3, CURRENT_TIMESTAMP),
  ('stockgroup-liknande', 'alcohol', 'Alkoholdrycksliknande', 'ALKOHOLDRYCKSLIKNANDE', 4, CURRENT_TIMESTAMP),
  ('stockgroup-dryck', 'cafe', 'Dryck', NULL, 0, CURRENT_TIMESTAMP);

-- Products: into the alcohol stock, each under its category's group.
ALTER TABLE "StockProduct" ADD COLUMN "stockId" TEXT,
ADD COLUMN "groupId" TEXT,
ADD COLUMN "packSize" INTEGER,
ALTER COLUMN "category" DROP NOT NULL;

UPDATE "StockProduct" p
SET "stockId" = 'alcohol',
    "groupId" = (SELECT g."id" FROM "StockGroup" g WHERE g."category" = p."category");

ALTER TABLE "StockProduct" ALTER COLUMN "stockId" SET NOT NULL,
ALTER COLUMN "groupId" SET NOT NULL;

-- The restaurangrapport is filed from the alcohol stock, so a product there
-- has a drink category. Prisma cannot say "required in one stock".
ALTER TABLE "StockProduct" ADD CONSTRAINT "StockProduct_alcohol_has_category"
  CHECK ("stockId" <> 'alcohol' OR "category" IS NOT NULL);

-- Events: the bar's.
ALTER TABLE "StockEvent" ADD COLUMN "costCenterId" TEXT,
ADD COLUMN "stockId" TEXT;
UPDATE "StockEvent" SET "stockId" = 'alcohol';
ALTER TABLE "StockEvent" ALTER COLUMN "stockId" SET NOT NULL;

ALTER TABLE "StockEntry" ADD COLUMN "batchId" TEXT,
ADD COLUMN "supplierInvoiceId" TEXT;

DROP TABLE "StockSettings";

DROP INDEX "StockEvent_date_name_idx";
CREATE UNIQUE INDEX "StockGroup_category_key" ON "StockGroup"("category");
CREATE UNIQUE INDEX "StockGroup_stockId_name_key" ON "StockGroup"("stockId", "name");
CREATE UNIQUE INDEX "StockEntry_batchId_productId_kind_key" ON "StockEntry"("batchId", "productId", "kind");
CREATE INDEX "StockEvent_stockId_date_name_idx" ON "StockEvent"("stockId", "date", "name");
CREATE INDEX "StockProduct_stockId_idx" ON "StockProduct"("stockId");
CREATE INDEX "StockProduct_groupId_idx" ON "StockProduct"("groupId");

ALTER TABLE "Stock" ADD CONSTRAINT "Stock_consumptionCostCenterId_fkey" FOREIGN KEY ("consumptionCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_purchaseCostCenterId_fkey" FOREIGN KEY ("purchaseCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_lossCostCenterId_fkey" FOREIGN KEY ("lossCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_countDiffCostCenterId_fkey" FOREIGN KEY ("countDiffCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_boardCostCenterId_fkey" FOREIGN KEY ("boardCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_boardSalesCostCenterId_fkey" FOREIGN KEY ("boardSalesCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockGroup" ADD CONSTRAINT "StockGroup_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockProduct" ADD CONSTRAINT "StockProduct_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockProduct" ADD CONSTRAINT "StockProduct_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StockGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockEvent" ADD CONSTRAINT "StockEvent_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockEvent" ADD CONSTRAINT "StockEvent_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Who holds the new capabilities to begin with. Rows, so the section can move
-- them under Inställningar -> Roller. No Authentik group is mapped to the two
-- new roles here: which groups are the café's and the board's is set there.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES
  ('CAFE_STOCKARE', 'CAFE_STOCK_VIEW'),
  ('CAFE_STOCKARE', 'CAFE_STOCK_REFILL'),
  ('CAFE_STOCKARE', 'CAFE_STOCK_MANAGE'),
  ('CAFE_STOCKARE', 'BUDGET_VIEW'),
  ('SKATTMASTARE', 'CAFE_STOCK_VIEW'),
  ('SKATTMASTARE', 'CAFE_STOCK_REFILL'),
  ('SKATTMASTARE', 'CAFE_STOCK_MANAGE'),
  ('ORDFORANDE', 'CAFE_STOCK_VIEW'),
  ('ORDFORANDE', 'CAFE_STOCK_REFILL'),
  ('ORDFORANDE', 'CAFE_STOCK_MANAGE'),
  ('REVISOR', 'CAFE_STOCK_VIEW'),
  ('STYRELSE', 'BOARD_TAB'),
  ('STYRELSE', 'BUDGET_VIEW')
ON CONFLICT DO NOTHING;
