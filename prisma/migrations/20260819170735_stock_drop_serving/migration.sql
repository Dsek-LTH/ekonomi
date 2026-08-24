-- SERVING is gone: drink is served out of what was taken to a pub, so what was
-- drunk is the difference between a checkout and its return rather than a
-- movement anybody types.
--
-- Guarded rather than cast blindly. A row on the value would be a real event
-- that has to be re-recorded as something the model still has words for, and
-- rewriting it into WASTE would quietly turn "we sold it" into "we spilled it".
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM "StockEntry" WHERE kind = 'SERVING';
  IF n > 0 THEN
    RAISE EXCEPTION 'cannot drop SERVING: % log row(s) still use it.', n;
  END IF;
END $$;

BEGIN;
CREATE TYPE "StockEntryKind_new" AS ENUM ('PURCHASE', 'CHECKOUT', 'RETURN', 'WASTE', 'COUNT', 'CORRECTION');
ALTER TABLE "StockEntry" ALTER COLUMN "kind" TYPE "StockEntryKind_new"
  USING ("kind"::text::"StockEntryKind_new");
ALTER TYPE "StockEntryKind" RENAME TO "StockEntryKind_old";
ALTER TYPE "StockEntryKind_new" RENAME TO "StockEntryKind";
DROP TYPE "public"."StockEntryKind_old";
COMMIT;
