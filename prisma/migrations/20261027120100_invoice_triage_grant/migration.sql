-- Who keeps the levfaktura inkorg, on the day there was one: the treasury, the
-- same people who work in Fortnox, since that is where every invoice ends up.
-- A row each, so the section can move it under Inställningar → Roller.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES
  ('SKATTMASTARE', 'INVOICE_TRIAGE'),
  ('VICE_SKATTMASTARE', 'INVOICE_TRIAGE'),
  ('SKATTFORMAN', 'INVOICE_TRIAGE')
ON CONFLICT DO NOTHING;
