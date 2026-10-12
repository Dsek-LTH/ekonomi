-- When the rent falls due. Null means "at pickup", which is what the villkor
-- say when no date is given. The payment clause refers to this, so it has to be
-- a column rather than a sentence somebody typed into the purpose field.
ALTER TABLE "RentalDetails" ADD COLUMN "paymentDueAt" DATE;
