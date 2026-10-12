-- Uthyrningsansvarig, on the day the role stopped being impossible.
--
-- Its own migration for the reason the deadline waiver's gives: Postgres will
-- not let a transaction use an enum value added by that same transaction, so
-- the role and the two capabilities added in the previous migration can only be
-- inserted here.
--
-- And it has to exist at all because DEFAULT_ROLE_CAPABILITIES is not deployed.
-- That list is what a seeded database starts from; a running deployment has
-- rows, so a capability nobody has ever granted there is a capability nobody
-- holds.

-- What the role may do: the uthyrningsavtal and the gear catalogue, and
-- nothing else in the archive. Deliberately no CONTRACT_VIEW, which is the
-- whole point of the role existing: a sponsoravtal's terms are none of its
-- business.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES
  ('UTHYRNINGSANSVARIG', 'RENTAL_VIEW'),
  ('UTHYRNINGSANSVARIG', 'RENTAL_MANAGE')
ON CONFLICT DO NOTHING;

-- Which Authentik group confers it. A guess, and safe to guess: this is a row
-- the section edits in Inställningar → Roller, and a mapping written against a
-- group nobody holds grants nothing and is reported there as granting nothing.
-- Point it at the real group once it is known.
INSERT INTO "GroupRole" ("group", "role")
VALUES ('dsek.km.uthyrning', 'UTHYRNINGSANSVARIG')
ON CONFLICT DO NOTHING;
