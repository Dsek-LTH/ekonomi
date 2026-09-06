-- Who holds the dispens, on the day it stopped being impossible.
--
-- The skattmästare alone, the same as BUDGET_LOCK and BUDGET_CHANGE_LOCKED:
-- departing from a rule the section set is the same kind of act as sealing the
-- figures it set. It is a row, so the section can move it in Inställningar
-- afterwards, and the only role that can is the one holding SETTINGS, which is
-- this one.
--
-- Its own migration because the value it names was added to the Capability enum
-- in the previous one. Postgres will not let a transaction use an enum value
-- added by that same transaction.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES ('SKATTMASTARE', 'EXPENSE_DEADLINE_WAIVE')
ON CONFLICT DO NOTHING;
