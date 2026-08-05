-- The utlägg reference changes shape again:
--
--     D-26|0042   ->   DEK26-0042
--
-- It is no longer only an internal number: it is appended in parentheses to the
-- voucher text pushed to Fortnox (api/expenses/[id]/export), so it is read by
-- anyone tracing a line in the section's books back to an utlägg here. Hence a
-- shape that reads as a reference on its own, away from this app.
--
-- Anchored to the old shape, as the previous rewrite was: a hand-edited row is
-- left alone rather than mangled into something that looks official, and
-- lib/domain/reference.ts treats anything unparseable as "no reference", so a
-- survivor cannot poison the counter either. The counter is matched as one or
-- more digits, not exactly four — it stops being padded once it passes 9999.
UPDATE "Expense"
SET "reference" =
      'DEK' || substring("reference" FROM 3 FOR 2) || '-' || substring("reference" FROM 6)
WHERE "reference" ~ '^D-[0-9]{2}\|[0-9]+$';
