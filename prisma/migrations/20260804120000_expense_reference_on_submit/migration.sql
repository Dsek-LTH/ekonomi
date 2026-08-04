-- The utlägg reference is now assigned when the utlägg is SUBMITTED for attest,
-- not when the draft row is created, and it carries a new format:
--
--     U-2026-0042   ->   D-26|0042
--
-- The unique index is left as it is: Postgres lets a unique index hold any
-- number of NULLs, which is exactly what an un-submitted draft now is.
ALTER TABLE "Expense" ALTER COLUMN "reference" DROP NOT NULL;

-- Rewrite the references that already exist. Anchored to the old shape so a
-- hand-edited row is left alone rather than mangled into something that looks
-- official; lib/domain/reference.ts treats anything unparseable as "no
-- reference", so a survivor can't poison the counter either.
UPDATE "Expense"
SET "reference" =
      'D-' || substring("reference" FROM 5 FOR 2) || '|' || substring("reference" FROM 8)
WHERE "reference" ~ '^U-[0-9]{4}-[0-9]{4}$';

-- Hand back the numbers held by utlägg that never went for attest. These are
-- the rows that would not be numbered at all under the new rule, and leaving
-- them numbered would mean the sequence starts with holes it never had.
UPDATE "Expense" SET "reference" = NULL WHERE "status" IN ('DRAFT', 'PENDING_MATCH');
