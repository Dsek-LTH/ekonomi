-- The Inkorg is triage's alone. Giving a document to a unit makes the
-- invoice (ASSIGNED), so a document no longer says which unit it was given to.
-- Every document still waiting in a unit's Inkorg becomes such an invoice
-- first, with the history it would have been born with.

CREATE TEMP TABLE "_assigned" AS
SELECT
  d."id" AS "documentId",
  gen_random_uuid()::text AS "invoiceId",
  row_number() OVER (ORDER BY COALESCE(m."receivedAt", d."createdAt"), d."id") AS "rn",
  d."resultUnitId",
  d."assignedById",
  d."assignedAt",
  d."dueDate",
  d."inboundMailId",
  COALESCE(m."receivedAt", d."createdAt") AS "receivedAt",
  CASE WHEN m."id" IS NULL THEN d."uploadedById" ELSE m."senderId" END AS "receivedById",
  CASE WHEN m."id" IS NULL THEN 'UPLOAD' ELSE 'EMAIL' END AS "source"
FROM "SupplierInvoiceDocument" d
LEFT JOIN "InboundMail" m ON m."id" = d."inboundMailId"
WHERE d."invoiceId" IS NULL AND d."resultUnitId" IS NOT NULL;

-- Numbered after the highest LEV number of this year, as claimInvoiceReference does.
INSERT INTO "SupplierInvoice" (
  "id", "reference", "status", "source", "receivedById", "resultUnitId",
  "assignedById", "assignedAt", "dueDate", "inboundMailId", "createdAt", "updatedAt"
)
SELECT
  a."invoiceId",
  'LEV' || to_char(CURRENT_DATE, 'YY') || '-' || lpad((l."n" + a."rn")::text, 4, '0'),
  'ASSIGNED',
  a."source"::"SupplierInvoiceSource",
  a."receivedById",
  a."resultUnitId",
  a."assignedById",
  a."assignedAt",
  a."dueDate",
  a."inboundMailId",
  COALESCE(a."assignedAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "_assigned" a
CROSS JOIN (
  SELECT COALESCE(MAX(substring("reference" FROM 7)::int), 0) AS "n"
  FROM "SupplierInvoice"
  WHERE "reference" LIKE 'LEV' || to_char(CURRENT_DATE, 'YY') || '-%'
) l;

INSERT INTO "SupplierInvoiceEvent" ("id", "invoiceId", "type", "actorId", "createdAt")
SELECT gen_random_uuid()::text, a."invoiceId", 'RECEIVED', a."receivedById", a."receivedAt"
FROM "_assigned" a;

INSERT INTO "SupplierInvoiceEvent" ("id", "invoiceId", "type", "actorId", "diff", "createdAt")
SELECT
  gen_random_uuid()::text,
  a."invoiceId",
  'ASSIGNED',
  a."assignedById",
  jsonb_build_object('from', NULL, 'to', u."name"),
  COALESCE(a."assignedAt", a."receivedAt")
FROM "_assigned" a
JOIN "ResultUnit" u ON u."id" = a."resultUnitId";

UPDATE "SupplierInvoiceDocument" d
SET "invoiceId" = a."invoiceId",
    "position" = 0,
    "returnedFrom" = NULL,
    "returnNote" = NULL
FROM "_assigned" a
WHERE d."id" = a."documentId";

DROP TABLE "_assigned";

ALTER TABLE "SupplierInvoiceDocument" DROP CONSTRAINT "SupplierInvoiceDocument_resultUnitId_fkey";
ALTER TABLE "SupplierInvoiceDocument" DROP CONSTRAINT "SupplierInvoiceDocument_assignedById_fkey";
DROP INDEX "SupplierInvoiceDocument_resultUnitId_idx";
ALTER TABLE "SupplierInvoiceDocument"
  DROP COLUMN "resultUnitId",
  DROP COLUMN "assignedById",
  DROP COLUMN "assignedAt",
  DROP COLUMN "dueDate";
