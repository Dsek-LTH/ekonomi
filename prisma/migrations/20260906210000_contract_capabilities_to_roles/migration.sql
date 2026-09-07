-- Who holds the avtal capabilities, on the day they stopped being impossible.
--
-- Its own migration, and the reason is the same one the deadline waiver's
-- migration gives: Postgres will not let a transaction use an enum value added
-- by that same transaction, so the values added in 20260906164442 and
-- 20260906205836 can only be inserted here.
--
-- The deeper reason this file has to exist at all is that
-- DEFAULT_ROLE_CAPABILITIES is not deployed. It is what a *seeded* database
-- starts from and what the settings screen restores from; a running deployment
-- has rows, and a capability nobody has ever granted there is a capability
-- nobody holds. Without this the avtal pages would be invisible to everyone on
-- the section's real database, including the treasurer, and the rental form
-- would offer an empty list of signatories.
--
-- These are rows, so the section can move them in Inställningar afterwards.

-- Reading the archive: the treasury and the people who answer for a result
-- unit. Deliberately not ORDINARIE, unlike the budget: the archive holds names,
-- contact details and terms belonging to people who are not members and never
-- chose to be visible to the whole section.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES
  ('SKATTMASTARE', 'CONTRACT_VIEW'),
  ('ORDFORANDE', 'CONTRACT_VIEW'),
  ('VICE_SKATTMASTARE', 'CONTRACT_VIEW'),
  ('SKATTFORMAN', 'CONTRACT_VIEW'),
  ('RESULTATANSVARIG', 'CONTRACT_VIEW')
ON CONFLICT DO NOTHING;

-- Filing a contract, drawing an uthyrningsavtal, keeping the gear catalogue.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES
  ('SKATTMASTARE', 'CONTRACT_MANAGE'),
  ('ORDFORANDE', 'CONTRACT_MANAGE')
ON CONFLICT DO NOTHING;

-- Firmateckning, as the stadgar have it: ordföranden och skattmästaren, each of
-- them severally. These rows do not grant the authority, they record who holds
-- it, so the rental form can offer the right names and refuse the wrong ones.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES
  ('ORDFORANDE', 'FIRMATECKNARE'),
  ('SKATTMASTARE', 'FIRMATECKNARE')
ON CONFLICT DO NOTHING;
