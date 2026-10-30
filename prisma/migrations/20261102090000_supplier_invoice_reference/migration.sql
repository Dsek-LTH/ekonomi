-- Levfakturor get a number of their own, "LEV26-0012", the utlägg's
-- DEK26-0042 in a series beside it (lib/domain/reference.ts).
ALTER TABLE "SupplierInvoice" ADD COLUMN "reference" TEXT;

CREATE UNIQUE INDEX "SupplierInvoice_reference_key" ON "SupplierInvoice"("reference");

-- The invoices already here are numbered in the order they arrived, by the
-- Stockholm year they arrived in, the same year a new one is numbered by.
-- "createdAt" is a UTC time without a zone, hence the two AT TIME ZONEs.
UPDATE "SupplierInvoice" AS si
SET "reference" = numbered.ref
FROM (
  SELECT
    "id",
    'LEV' || to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Stockholm', 'YY') || '-' ||
      lpad(
        row_number() OVER (
          PARTITION BY date_part('year', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Stockholm')
          ORDER BY "createdAt", "id"
        )::text,
        4,
        '0'
      ) AS ref
  FROM "SupplierInvoice"
) AS numbered
WHERE si."id" = numbered."id";
