-- Who may send reminders, on the day it became possible: the two roles that
-- hold ADMIN. A row each, so the section can give it to somebody else under
-- Inställningar → Roller, or take it away.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES ('SKATTMASTARE', 'SEND_REMINDERS'), ('ORDFORANDE', 'SEND_REMINDERS')
ON CONFLICT DO NOTHING;
