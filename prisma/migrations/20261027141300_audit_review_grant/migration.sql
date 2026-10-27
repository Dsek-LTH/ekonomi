-- The revisorer review the year's vouchers.
--
-- Its own migration because AUDIT_REVIEW was added to the Capability enum in
-- the previous one, and Postgres will not let a transaction use an enum value
-- added by that same transaction.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES ('REVISOR', 'AUDIT_REVIEW')
ON CONFLICT DO NOTHING;
