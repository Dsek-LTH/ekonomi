-- CreateTable
CREATE TABLE "ExpensePresence" (
    "expenseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpensePresence_pkey" PRIMARY KEY ("expenseId","userId")
);

-- CreateIndex
CREATE INDEX "ExpensePresence_lastSeenAt_idx" ON "ExpensePresence"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "ExpensePresence" ADD CONSTRAINT "ExpensePresence_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePresence" ADD CONSTRAINT "ExpensePresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
