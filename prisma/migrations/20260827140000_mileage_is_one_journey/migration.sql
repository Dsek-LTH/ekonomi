-- A milersättning is one journey, recorded by the odometer.
--
-- Two changes to what 20260827120000_milersattning built, and both are the same
-- change of mind. A claim held a sheet of journeys, each with a route typed as
-- "from" and "to" and a distance somebody worked out; it now holds one journey,
-- described by what the car's odometer said when it was got into and when it
-- was got out of. Somebody who drove three times files three claims — each one
-- attested on its own, on its own cost centre, paid as its own claim.
--
-- The readings are the point. A distance is a number somebody arrived at; two
-- odometer readings are a statement about what a dashboard showed, which is a
-- thing that can be checked.
ALTER TABLE "Expense" ADD COLUMN "odometerStart" DECIMAL(9,1);
ALTER TABLE "Expense" ADD COLUMN "odometerEnd" DECIMAL(9,1);
ALTER TABLE "Expense" ADD COLUMN "mileageOrePerKm" INTEGER;

-- Carry what the old claims were worth, not what their odometers said — which
-- nobody recorded, because the old form never asked. The distance and the rate
-- survive exactly; the readings are written as 0 → distance, which is visibly
-- synthetic rather than a plausible-looking invention. A claim that had already
-- been paid is therefore still worth what was paid.
--
-- In practice this is a handful of dev rows: the feature has not been released.
UPDATE "Expense" e
SET "odometerStart" = 0,
    "odometerEnd" = t.km,
    "mileageOrePerKm" = t."orePerKm"
FROM (
    SELECT "expenseId",
           SUM("km") AS km,
           -- The rate the journeys were valued at. MAX rather than an
           -- arbitrary pick: where a sheet spanned a rate change the higher one
           -- is the newer, and folding several journeys into one leaves no
           -- honest way to keep both.
           MAX("orePerKm") AS "orePerKm"
    FROM "MileageTrip"
    GROUP BY "expenseId"
) t
WHERE e.id = t."expenseId";

DROP TABLE "MileageTrip";
