-- What a revisor may do: read everything, change nothing.
--
-- Its own migration because the values it names were added in the previous
-- one. Postgres will not let a transaction use an enum value added by that same
-- transaction.
--
-- Every view capability and none of the acting ones. Not ATTEST_VIEW: the
-- attest queue is a list of work, and every utlägg in it is already readable
-- through BOOKKEEPING_VIEW.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES
  ('REVISOR', 'BOOKKEEPING_VIEW'),
  ('REVISOR', 'BUDGET_VIEW'),
  ('REVISOR', 'STOCK_VIEW'),
  ('REVISOR', 'CONTRACT_VIEW')
ON CONFLICT DO NOTHING;

-- Which Authentik group confers it. A guess, and safe to guess for the reason
-- the uthyrning mapping gives: a mapping against a group nobody holds grants
-- nothing, and Inställningar → Roller reports it as granting nothing. Point it
-- at the real group once it is known.
INSERT INTO "GroupRole" ("group", "role")
VALUES ('dsek.revisor', 'REVISOR')
ON CONFLICT DO NOTHING;
