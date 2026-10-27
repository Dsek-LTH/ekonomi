-- The skattmästare may bokföra what they konterade themselves. A row, so the
-- section can move it in Inställningar → Roller.
--
-- Its own migration because the value it names was added to the Capability enum
-- in the previous one. Postgres will not let a transaction use an enum value
-- added by that same transaction.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES ('SKATTMASTARE', 'REVIEW_OWN_BOOKING')
ON CONFLICT DO NOTHING;
