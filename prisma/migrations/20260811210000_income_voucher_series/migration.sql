-- Which verifikationsserie income exports go to.
--
-- Nullable on purpose: null is "whatever series the Fortnox connection uses",
-- which is what every income voucher was written to before this column existed.
-- So an install that upgrades and sets nothing keeps exporting exactly where it
-- did, and a section that wants its takings kept apart from its utlägg says so
-- once, in Inställningar.
ALTER TABLE "BookkeepingSettings" ADD COLUMN "incomeVoucherSeries" TEXT;
