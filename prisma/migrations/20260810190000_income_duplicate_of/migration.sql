-- A fetched day that is already booked here is now imported and flagged, the
-- same as one Fortnox already has a voucher for.
--
-- It used to be dropped, which is the failure this keeps undoing: a day that is
-- simply absent from the queue reads as takings that went missing, and there is
-- no way to tell that from a fetch that never covered it. Shown and coloured,
-- it is a fact the reviewer can act on. Booking it stays impossible — the
-- partial unique index over booked reports is what actually guarantees that.
ALTER TABLE "IncomeReport" ADD COLUMN "duplicateOfId" TEXT;

ALTER TABLE "IncomeReport"
  ADD CONSTRAINT "IncomeReport_duplicateOfId_fkey"
  FOREIGN KEY ("duplicateOfId") REFERENCES "IncomeReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "IncomeReport_duplicateOfId_idx" ON "IncomeReport"("duplicateOfId");
