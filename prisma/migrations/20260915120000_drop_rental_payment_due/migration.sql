-- The villkor leave the due date to the invoice (rental/terms.ts, § 2), so a
-- contract no longer carries one of its own. A signed PDF that printed a date
-- still has it, and the PDF is the record.
ALTER TABLE "RentalDetails" DROP COLUMN "paymentDueAt";
