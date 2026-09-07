-- The budget is the section's, not the treasury's.
--
-- Every role holds BUDGET_VIEW, and a new role that quietly did not would be
-- the first crack in that. lib/domain/permissions.test.ts asserts it for every
-- member of ROLES, which is how this omission was caught rather than shipped.
--
-- Its own migration rather than an edit to 20260906230000, because that one has
-- already been applied and Prisma checksums applied migrations.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES ('UTHYRNINGSANSVARIG', 'BUDGET_VIEW')
ON CONFLICT DO NOTHING;
