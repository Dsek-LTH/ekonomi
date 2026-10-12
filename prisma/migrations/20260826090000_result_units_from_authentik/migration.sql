-- Who answers for a result unit stops being a row somebody maintains here and
-- becomes a fact derived from the Authentik group list, exactly as roles
-- already were (lib/server/authentik-roles.ts). The mapping is group → result
-- unit *name*, which is why the column holds names rather than ids.
ALTER TABLE "User" ADD COLUMN "resultUnits" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Carry the existing ownerships over, so authority does not lapse between this
-- migration and each holder's next sign-in (which is when the group list is
-- read again and the column is rewritten from it).
UPDATE "User" u
SET "resultUnits" = sub.names
FROM (
  SELECT o."userId" AS user_id, array_agg(DISTINCT r."name") AS names
  FROM "ResultUnitOwner" o
  JOIN "ResultUnit" r ON r."id" = o."resultUnitId"
  GROUP BY o."userId"
) sub
WHERE u."id" = sub.user_id;

DROP TABLE "ResultUnitOwner";
