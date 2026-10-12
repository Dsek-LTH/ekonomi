-- Sign-in moved from Google to the guild's Authentik, and with it the identity
-- the app keys a user on: the student id Authentik sends as
-- `preferred_username`. Email stays, as a descriptive field.
--
-- The column is NOT NULL with no default, so this migration cannot be applied
-- to a table that already has rows, which is the intended answer for this
-- database: no student id can be invented for an existing row, and the seed is
-- the only data there is. Run `pnpm db:seed` after migrating.
ALTER TABLE "User" ADD COLUMN "studentId" TEXT NOT NULL;

CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");
