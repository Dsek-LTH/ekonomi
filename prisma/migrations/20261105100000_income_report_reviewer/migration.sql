-- Who approved each day of takings, and when. Approving a day is what books it.

ALTER TABLE "IncomeReport"
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

ALTER TABLE "IncomeReport" ADD CONSTRAINT "IncomeReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Days booked before this existed were approved by whoever booked them, which
-- is who wrote their verifikation. Their stored documents are left as they are.
UPDATE "IncomeReport" AS r
SET "reviewedById" = v."createdById", "reviewedAt" = v."createdAt"
FROM "Verification" AS v
WHERE v."incomeReportId" = r."id" AND r."status" <> 'DRAFT';
