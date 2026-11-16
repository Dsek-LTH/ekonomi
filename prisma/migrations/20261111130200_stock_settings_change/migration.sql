-- Who changed how a stock is booked: an account, a cost centre, the day posting
-- starts. See StockSettingsChange in stock.prisma.
-- CreateTable
CREATE TABLE "StockSettingsChange" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "groupName" TEXT,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "StockSettingsChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockSettingsChange_stockId_at_idx" ON "StockSettingsChange"("stockId", "at");

-- AddForeignKey
ALTER TABLE "StockSettingsChange" ADD CONSTRAINT "StockSettingsChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

