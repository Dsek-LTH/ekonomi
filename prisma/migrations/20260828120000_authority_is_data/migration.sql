-- Authority stops being three tables in lib/server/authentik-roles.ts and one
-- set of hard-coded role lists in lib/domain/permissions.ts, and becomes rows.
--
-- The seed below is those tables, copied out verbatim as they stood at this
-- migration. That is the point of doing it here rather than in prisma/seed.ts:
-- the deploy that runs this must not change anybody's authority. Whoever could
-- reach Inställningar before it can reach Inställningar after it, and the first
-- edit is a deliberate one somebody makes on the screen.

-- ── Enum ──────────────────────────────────────────────────────────
CREATE TYPE "Capability" AS ENUM (
  'ADMIN',
  'BOOKKEEPING',
  'FORTNOX_LOGIN',
  'EXPORT_UNDO',
  'SETTINGS',
  'STOCK_VIEW',
  'STOCK_MANAGE',
  'BUDGET_VIEW',
  'BUDGET_COMMENT',
  'BUDGET_LOCK',
  'BUDGET_CHANGE_LOCKED',
  'ATTEST_VIEW'
);

-- ── The group list a derivation can be re-run from ────────────────
-- Empty for everyone until their next sign-in, which is correct: we do not know
-- what anybody's groups are until Authentik says so. Until then the settings
-- screen reports fewer holders than there are, and says as much rather than
-- pretending the blank is a zero.
ALTER TABLE "User" ADD COLUMN "authentikGroups" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ── Tables ────────────────────────────────────────────────────────
CREATE TABLE "GroupRole" (
  "group" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupRole_pkey" PRIMARY KEY ("group", "role")
);
CREATE INDEX "GroupRole_group_idx" ON "GroupRole"("group");

CREATE TABLE "GroupResultUnit" (
  "group" TEXT NOT NULL,
  "resultUnitId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupResultUnit_pkey" PRIMARY KEY ("group", "resultUnitId")
);
CREATE INDEX "GroupResultUnit_group_idx" ON "GroupResultUnit"("group");
CREATE INDEX "GroupResultUnit_resultUnitId_idx" ON "GroupResultUnit"("resultUnitId");
ALTER TABLE "GroupResultUnit"
  ADD CONSTRAINT "GroupResultUnit_resultUnitId_fkey"
  FOREIGN KEY ("resultUnitId") REFERENCES "ResultUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RoleCapability" (
  "role" "Role" NOT NULL,
  "capability" "Capability" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoleCapability_pkey" PRIMARY KEY ("role", "capability")
);
CREATE INDEX "RoleCapability_role_idx" ON "RoleCapability"("role");

-- ── Seed: group → role (was ROLE_OF_GROUP) ────────────────────────
INSERT INTO "GroupRole" ("group", "role") VALUES
  ('dsek.ordf',              'ORDFORANDE'),
  ('dsek.skattm.mastare',    'SKATTMASTARE'),
  ('dsek.skattm.vice_mastare','VICE_SKATTMASTARE'),
  ('dsek.skattm.fm',         'SKATTFORMAN');

-- ── Seed: group → role (was STOCK_GROUPS) ─────────────────────────
-- Alkohollagret. `dsek.sex.olfm` and `dsek.sex.vinfm` are absent here for the
-- same deliberate reason they were absent from the list this replaces.
INSERT INTO "GroupRole" ("group", "role") VALUES
  ('dsek.sex.mastare',        'STOCKARE'),
  ('dsek.sex.vice_mastare',   'STOCKARE'),
  ('dsek.sex.hov.mstr',       'STOCKARE'),
  ('dsek.sex.pub.mastare',    'STOCKARE'),
  ('dsek.sex.pub.vice_mastare','STOCKARE'),
  ('dsek.sex.bar.mstr',       'STOCKARE'),
  ('dsek.sex.bar.vice_mstr',  'STOCKARE');

-- ── Seed: group → result unit (was RESULT_UNITS) ──────────────────
-- Joined on name, which is how the old mapping was written. A name with no row
-- behind it granted nothing before and inserts nothing now — the difference is
-- that from here on it cannot be written at all, because the column is a key.
INSERT INTO "GroupResultUnit" ("group", "resultUnitId")
SELECT m."group", r."id"
FROM (VALUES
  ('dsek.aktu.mastare',  'Aktivitetsutskottet'),
  ('dsek.cafe.mastare',  'Caféutskottet'),
  ('dsek.cpu.mastare',   'CPU'),
  ('dsek.fram.ordf',     'Framtidsutskottet'),
  ('dsek.infu.mastare',  'Infoutskottet'),
  ('dsek.km.mastare',    'Källarmästeriet'),
  ('dsek.overmarskalk',  'Medaljkommittén'),
  ('dsek.nari.mastare',  'Näringslivsutskottet'),
  ('dsek.noll.stab.oph', 'Nollningsutskottet'),
  ('dsek.sex.mastare',   'Sexmästeriet'),
  ('dsek.srd.ordf',      'Studierådet'),
  ('dsek.tackm.mastare', 'Tackmästeriet'),
  ('dsek.triv.mastare',  'Trivselutskottet'),
  ('dsek.val.ordf',      'Valberedningen')
) AS m("group", "unit")
JOIN "ResultUnit" r ON r."name" = m."unit";

-- ── Seed: role → capability (was the lists in permissions.ts) ─────
-- ADMIN_ROLES
INSERT INTO "RoleCapability" ("role", "capability") VALUES
  ('SKATTMASTARE', 'ADMIN'),
  ('ORDFORANDE',   'ADMIN');

-- BOOKKEEPING_ROLES
INSERT INTO "RoleCapability" ("role", "capability") VALUES
  ('SKATTMASTARE',      'BOOKKEEPING'),
  ('ORDFORANDE',        'BOOKKEEPING'),
  ('VICE_SKATTMASTARE', 'BOOKKEEPING'),
  ('SKATTFORMAN',       'BOOKKEEPING');

-- TREASURY_ROLES — Fortnox login, and unwinding an export
INSERT INTO "RoleCapability" ("role", "capability") VALUES
  ('SKATTMASTARE',      'FORTNOX_LOGIN'),
  ('VICE_SKATTMASTARE', 'FORTNOX_LOGIN'),
  ('SKATTFORMAN',       'FORTNOX_LOGIN'),
  ('SKATTMASTARE',      'EXPORT_UNDO'),
  ('VICE_SKATTMASTARE', 'EXPORT_UNDO'),
  ('SKATTFORMAN',       'EXPORT_UNDO');

-- canAccessSettings — the treasurer alone, chair deliberately excluded
INSERT INTO "RoleCapability" ("role", "capability") VALUES
  ('SKATTMASTARE', 'SETTINGS');

-- STOCK_ROLES
INSERT INTO "RoleCapability" ("role", "capability") VALUES
  ('STOCKARE',     'STOCK_VIEW'),
  ('SKATTMASTARE', 'STOCK_VIEW'),
  ('ORDFORANDE',   'STOCK_VIEW'),
  ('STOCKARE',     'STOCK_MANAGE'),
  ('SKATTMASTARE', 'STOCK_MANAGE'),
  ('ORDFORANDE',   'STOCK_MANAGE');

-- canAccessBudget was `() => true`: every role, so that turning it off for one
-- of them is a decision somebody makes rather than a default nobody chose.
INSERT INTO "RoleCapability" ("role", "capability")
SELECT r, 'BUDGET_VIEW'::"Capability" FROM unnest(ARRAY[
  'SKATTMASTARE', 'ORDFORANDE', 'VICE_SKATTMASTARE', 'SKATTFORMAN',
  'RESULTATANSVARIG', 'STOCKARE', 'ORDINARIE'
]::"Role"[]) AS r;

-- canCommentBudget — admins plus the resultatansvariga
INSERT INTO "RoleCapability" ("role", "capability") VALUES
  ('SKATTMASTARE',     'BUDGET_COMMENT'),
  ('ORDFORANDE',       'BUDGET_COMMENT'),
  ('RESULTATANSVARIG', 'BUDGET_COMMENT');

-- canLockBudget / canChangeLockedBudget — the treasurer alone
INSERT INTO "RoleCapability" ("role", "capability") VALUES
  ('SKATTMASTARE', 'BUDGET_LOCK'),
  ('SKATTMASTARE', 'BUDGET_CHANGE_LOCKED');

-- ATTEST_ROLES
INSERT INTO "RoleCapability" ("role", "capability") VALUES
  ('SKATTMASTARE',      'ATTEST_VIEW'),
  ('ORDFORANDE',        'ATTEST_VIEW'),
  ('VICE_SKATTMASTARE', 'ATTEST_VIEW'),
  ('RESULTATANSVARIG',  'ATTEST_VIEW');
