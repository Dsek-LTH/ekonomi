-- An attester (typically an utskottsmästare) can pull back their own attest
-- until the utlägg is booked; the audit trail needs a type for it.
ALTER TYPE "ExpenseEventType" ADD VALUE 'ATTEST_WITHDRAWN';
