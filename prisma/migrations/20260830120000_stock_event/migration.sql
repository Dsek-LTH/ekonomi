-- StockTag becomes StockEvent, and the column that points at it becomes
-- eventId.
--
-- A rename and not a rebuild. Everything here is ALTER ... RENAME, so no row is
-- copied and no foreign key is dropped: the table this touches is the ledger
-- every stock figure is summed from, and a drop-and-recreate migration would be
-- betting the cellar on a restore. Prisma's own diff would have written exactly
-- that, which is why this one is written out by hand.
--
-- Postgres keeps the *old* names for indexes and constraints when their table
-- or column is renamed, so each has to be renamed in turn — otherwise the
-- database is correct but Prisma's next diff sees names it did not expect and
-- proposes to fix them.
ALTER TABLE "StockTag" RENAME TO "StockEvent";
ALTER TABLE "StockEntry" RENAME COLUMN "tagId" TO "eventId";
ALTER TABLE "StockChange" RENAME COLUMN "tagId" TO "eventId";

-- Renaming a primary key's index renames its constraint with it; the others are
-- plain indexes and are renamed on their own.
ALTER INDEX "StockTag_pkey" RENAME TO "StockEvent_pkey";
ALTER INDEX "StockTag_date_name_idx" RENAME TO "StockEvent_date_name_idx";
ALTER INDEX "StockEntry_tagId_idx" RENAME TO "StockEntry_eventId_idx";
ALTER INDEX "StockEntry_tagId_productId_kind_level_key" RENAME TO "StockEntry_eventId_productId_kind_level_key";
ALTER INDEX "StockChange_tagId_at_idx" RENAME TO "StockChange_eventId_at_idx";

ALTER TABLE "StockEvent" RENAME CONSTRAINT "StockTag_actorId_fkey" TO "StockEvent_actorId_fkey";
ALTER TABLE "StockEntry" RENAME CONSTRAINT "StockEntry_tagId_fkey" TO "StockEntry_eventId_fkey";
ALTER TABLE "StockChange" RENAME CONSTRAINT "StockChange_tagId_fkey" TO "StockChange_eventId_fkey";
