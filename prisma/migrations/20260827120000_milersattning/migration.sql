-- Milersättning: driving the section's errand in one's own car.
--
-- A third payment type rather than a feature beside the utlägg. After
-- submission a mileage claim is a reimbursement in every respect — a debt to
-- the member, matched against the payout, booked against the same account —
-- so it rides the pipeline that already exists. What is its own is the way it
-- is entered (journeys, not an amount) and its underlag (a körjournal the app
-- typesets, not a receipt somebody photographs).
--
-- Safe inside Prisma's transaction on PG 12+: the new enum label is added here
-- and first *used* by a later statement in a later transaction. Nothing in this
-- migration writes it.
ALTER TYPE "PaymentType" ADD VALUE 'MILEAGE';

-- One journey. Kilometres because that is what a trip meter reads; one decimal
-- because a short errand is 4,2 km. `orePerKm` is copied onto the row from the
-- rate in force on `date`, so a filed claim never re-values when Skatteverket
-- moves the schablon — and one claim may span the new year, each trip worth
-- what it was worth on its own day.
CREATE TABLE "MileageTrip" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "fromPlace" TEXT NOT NULL,
    "toPlace" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "km" DECIMAL(7,1) NOT NULL,
    "orePerKm" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MileageTrip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MileageTrip_expenseId_idx" ON "MileageTrip"("expenseId");

ALTER TABLE "MileageTrip" ADD CONSTRAINT "MileageTrip_expenseId_fkey"
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What a kilometre is worth, from a given day. A table rather than a constant:
-- the figure is Skatteverket's, it moves at a new year, and a deploy is the
-- wrong way to find that out.
CREATE TABLE "MileageRate" (
    "id" TEXT NOT NULL,
    "orePerKm" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MileageRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MileageRate_validFrom_key" ON "MileageRate"("validFrom");
CREATE INDEX "MileageRate_validFrom_idx" ON "MileageRate"("validFrom");

ALTER TABLE "MileageRate" ADD CONSTRAINT "MileageRate_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The schablon as it stands, so the feature works the moment it is deployed
-- rather than after somebody remembers to open the admin screen. 25 kr/mil.
INSERT INTO "MileageRate" ("id", "orePerKm", "validFrom", "note", "updatedAt")
VALUES ('mileage-rate-seed-2023', 250, DATE '2023-01-01', 'Skatteverkets schablon, egen bil', CURRENT_TIMESTAMP);
