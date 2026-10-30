-- CreateTable
CREATE TABLE "FortnoxSync" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "runningSince" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastResult" JSONB,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FortnoxSync_pkey" PRIMARY KEY ("id")
);
