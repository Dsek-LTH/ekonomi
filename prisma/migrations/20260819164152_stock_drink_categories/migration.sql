-- Dryckesslag, cut down to the five the bar actually keeps.
--
-- Two of the old values are renames rather than removals, so they are mapped by
-- hand: Prisma's generated cast goes through text and would fail on every row
-- carrying one. FOLKOL folds into OL for the same reason it is gone — beer is
-- beer here — and the two that have no home (LATTDRYCK, OVRIGT) are asserted
-- empty rather than silently rewritten into a drink they are not.
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM "StockProduct" WHERE category IN ('LATTDRYCK', 'OVRIGT');
  IF n > 0 THEN
    RAISE EXCEPTION 'cannot drop LATTDRYCK/OVRIGT: % product(s) still use them. Re-categorise them first.', n;
  END IF;
END $$;

BEGIN;
CREATE TYPE "DrinkCategory_new" AS ENUM ('SPRITDRYCK', 'VIN', 'OVRIG_JASTDRYCK', 'OL', 'ALKOHOLDRYCKSLIKNANDE');

ALTER TABLE "StockProduct" ALTER COLUMN "category" TYPE "DrinkCategory_new"
  USING (
    CASE "category"::text
      WHEN 'ANDRA_JASTA' THEN 'OVRIG_JASTDRYCK'
      WHEN 'STARKOL' THEN 'OL'
      WHEN 'FOLKOL' THEN 'OL'
      ELSE "category"::text
    END
  )::"DrinkCategory_new";

ALTER TYPE "DrinkCategory" RENAME TO "DrinkCategory_old";
ALTER TYPE "DrinkCategory_new" RENAME TO "DrinkCategory";
DROP TYPE "public"."DrinkCategory_old";
COMMIT;
