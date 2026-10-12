-- Containment indexes on the User array columns.
--
-- `roles`, `resultUnits` and `authentikGroups` are never read by equality,
-- they are asked "does this array contain / overlap these values", which
-- Postgres answers with `@>` and `&&`. A btree cannot serve either operator, so
-- until now every one of those questions was a sequential scan of the whole
-- member table.
--
-- The one that matters is `roles`: lib/server/capabilities.ts resolves the
-- acting user's capabilities on every gated request, and lib/data/attest-scope.ts
-- asks the same shape of question of the submitter on the attest queue.
--
-- Cheap to add now and awkward to add later, which is the whole argument: the
-- section is small enough that none of these are slow yet.
CREATE INDEX "User_roles_idx" ON "User" USING GIN ("roles");
CREATE INDEX "User_resultUnits_idx" ON "User" USING GIN ("resultUnits");
CREATE INDEX "User_authentikGroups_idx" ON "User" USING GIN ("authentikGroups");
