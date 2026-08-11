-- A day that Fortnox already has a voucher for is now imported and flagged,
-- rather than left out of the fetch entirely.
--
-- Leaving it out was the safer-looking choice and the worse one: a day that is
-- simply not there reads as takings that went missing, and the section may
-- legitimately have two vouchers for one verksamhet on one day. The reviewer
-- gets the day, coloured as a warning and naming the voucher that already
-- exists, and decides.
ALTER TABLE "IncomeReport" ADD COLUMN "existingVoucher" TEXT;
