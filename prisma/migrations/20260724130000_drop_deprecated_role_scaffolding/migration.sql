-- Remove the transitional/deprecated role scaffolding now that attest is fully
-- role- and committee-based: the per-cost-centre approver, the old committee
-- owner table, and the unused CommitteePosition.

-- DropForeignKey
ALTER TABLE "CommitteeOwner" DROP CONSTRAINT "CommitteeOwner_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "CostCenter" DROP CONSTRAINT "CostCenter_approverId_fkey";

-- AlterTable
ALTER TABLE "CostCenter" DROP COLUMN "approverId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "position";

-- DropTable
DROP TABLE "CommitteeOwner";

-- DropEnum
DROP TYPE "CommitteePosition";
