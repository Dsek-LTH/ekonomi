-- AlterTable
ALTER TABLE "FortnoxConnection" ADD COLUMN     "refreshError" TEXT,
ADD COLUMN     "refreshFailedAt" TIMESTAMP(3);
