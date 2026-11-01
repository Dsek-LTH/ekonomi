-- AlterTable
ALTER TABLE "User" ADD COLUMN     "seenGuideSteps" TEXT[] DEFAULT ARRAY[]::TEXT[];
