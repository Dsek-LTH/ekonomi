-- Redovisningsbetyg: who may see every member's stars. A member sees their own
-- without it, so it is the treasury's view of the section that is granted.
--
-- Who holds it is set in the next migration. Postgres will not let a
-- transaction use an enum value added by that same transaction.

-- AlterEnum
ALTER TYPE "Capability" ADD VALUE 'MEMBER_SCORE_VIEW';
