-- Avtal, the archive and uthyrning moved to avtalaD, with their data. Ekonomi drops the
-- module: its tables, the capabilities that opened it and the role that ran uthyrningen.

-- The enums below are rebuilt by casting each stored value to the new type, which fails on a
-- value that no longer exists. So every row still holding one goes first.
DELETE FROM "RoleCapability"
WHERE "capability" IN ('CONTRACT_VIEW', 'CONTRACT_MANAGE', 'FIRMATECKNARE', 'RENTAL_VIEW', 'RENTAL_MANAGE')
   OR "role" = 'UTHYRNINGSANSVARIG';

DELETE FROM "AccessGrant"
WHERE "capability" IN ('CONTRACT_VIEW', 'CONTRACT_MANAGE', 'FIRMATECKNARE', 'RENTAL_VIEW', 'RENTAL_MANAGE')
   OR "role" = 'UTHYRNINGSANSVARIG';

DELETE FROM "GroupRole" WHERE "role" = 'UTHYRNINGSANSVARIG';

UPDATE "User" SET "roles" = array_remove("roles", 'UTHYRNINGSANSVARIG'::"Role")
WHERE 'UTHYRNINGSANSVARIG'::"Role" = ANY ("roles");

UPDATE "ChecklistTemplateItem" SET "ownerRole" = NULL WHERE "ownerRole" = 'UTHYRNINGSANSVARIG';
UPDATE "ChecklistItem" SET "ownerRole" = NULL WHERE "ownerRole" = 'UTHYRNINGSANSVARIG';
-- AlterEnum
BEGIN;
CREATE TYPE "Capability_new" AS ENUM ('ADMIN', 'BOOKKEEPING', 'FORTNOX_LOGIN', 'EXPORT_UNDO', 'SETTINGS', 'ALCOHOL_STOCK_VIEW', 'ALCOHOL_STOCK_MANAGE', 'BUDGET_VIEW', 'BUDGET_COMMENT', 'BUDGET_LOCK', 'BUDGET_CHANGE_LOCKED', 'ATTEST_VIEW', 'EXPENSE_DEADLINE_WAIVE', 'REVIEW_OWN_BOOKING', 'SEND_REMINDERS', 'INVOICE_TRIAGE', 'BOOKKEEPING_VIEW', 'AUDIT_REVIEW', 'MEMBER_SCORE_VIEW', 'CAFE_STOCK_VIEW', 'CAFE_STOCK_MANAGE', 'BOARD_TAB', 'GRANT_ACCESS');
ALTER TABLE "RoleCapability" ALTER COLUMN "capability" TYPE "Capability_new" USING ("capability"::text::"Capability_new");
ALTER TABLE "AccessGrant" ALTER COLUMN "capability" TYPE "Capability_new" USING ("capability"::text::"Capability_new");
ALTER TYPE "Capability" RENAME TO "Capability_old";
ALTER TYPE "Capability_new" RENAME TO "Capability";
DROP TYPE "Capability_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('SKATTMASTARE', 'ORDFORANDE', 'VICE_SKATTMASTARE', 'SKATTFORMAN', 'RESULTATANSVARIG', 'STOCKARE', 'REVISOR', 'ORDINARIE', 'CAFE_STOCKARE', 'STYRELSE');
ALTER TABLE "User" ALTER COLUMN "roles" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "roles" TYPE "Role_new"[] USING ("roles"::text::"Role_new"[]);
ALTER TABLE "GroupRole" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "RoleCapability" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "AccessGrant" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "ChecklistTemplateItem" ALTER COLUMN "ownerRole" TYPE "Role_new" USING ("ownerRole"::text::"Role_new");
ALTER TABLE "ChecklistItem" ALTER COLUMN "ownerRole" TYPE "Role_new" USING ("ownerRole"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "User" ALTER COLUMN "roles" SET DEFAULT ARRAY['ORDINARIE']::"Role"[];
COMMIT;

-- DropForeignKey
ALTER TABLE "Counterparty" DROP CONSTRAINT "Counterparty_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Contract" DROP CONSTRAINT "Contract_createdById_fkey";

-- DropForeignKey
ALTER TABLE "AgreementDetails" DROP CONSTRAINT "AgreementDetails_contractId_fkey";

-- DropForeignKey
ALTER TABLE "AgreementDetails" DROP CONSTRAINT "AgreementDetails_counterpartyId_fkey";

-- DropForeignKey
ALTER TABLE "ContractFile" DROP CONSTRAINT "ContractFile_contractId_fkey";

-- DropForeignKey
ALTER TABLE "ContractFile" DROP CONSTRAINT "ContractFile_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "RentalDetails" DROP CONSTRAINT "RentalDetails_contractId_fkey";

-- DropForeignKey
ALTER TABLE "RentalDetails" DROP CONSTRAINT "RentalDetails_checkedById_fkey";

-- DropForeignKey
ALTER TABLE "RentalLine" DROP CONSTRAINT "RentalLine_contractId_fkey";

-- DropForeignKey
ALTER TABLE "RentalLine" DROP CONSTRAINT "RentalLine_itemId_fkey";

-- DropTable
DROP TABLE "Counterparty";

-- DropTable
DROP TABLE "Contract";

-- DropTable
DROP TABLE "AgreementDetails";

-- DropTable
DROP TABLE "ContractFile";

-- DropTable
DROP TABLE "RentalDetails";

-- DropTable
DROP TABLE "RentalLine";

-- DropTable
DROP TABLE "RentalItem";

-- DropEnum
DROP TYPE "ContractKind";

-- DropEnum
DROP TYPE "ContractFileRole";

