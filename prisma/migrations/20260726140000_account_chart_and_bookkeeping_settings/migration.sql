-- The BAS chart of accounts, mirrored from Fortnox /3/accounts. Replaces the
-- short hardcoded list in lib/accounts.ts.
CREATE TABLE "Account" (
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sru" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("number")
);

CREATE INDEX "Account_active_idx" ON "Account"("active");

-- Seed the accounts the app previously hardcoded, so booking keeps working
-- before the first sync from Fortnox. A sync overwrites the names.
INSERT INTO "Account" ("number", "name", "updatedAt") VALUES
    ('1930', 'Företagskonto / sektionskort', CURRENT_TIMESTAMP),
    ('2440', 'Leverantörsskulder', CURRENT_TIMESTAMP),
    ('2640', 'Ingående moms', CURRENT_TIMESTAMP),
    ('2890', 'Skuld till medlem (eget utlägg)', CURRENT_TIMESTAMP),
    ('4000', 'Inköp av varor och material', CURRENT_TIMESTAMP),
    ('5410', 'Förbrukningsinventarier', CURRENT_TIMESTAMP),
    ('5460', 'Förbrukningsmaterial', CURRENT_TIMESTAMP),
    ('5810', 'Resekostnader', CURRENT_TIMESTAMP),
    ('6071', 'Representation, avdragsgill', CURRENT_TIMESTAMP),
    ('6072', 'Representation, ej avdragsgill', CURRENT_TIMESTAMP),
    ('6110', 'Kontorsmateriel', CURRENT_TIMESTAMP),
    ('6150', 'Trycksaker', CURRENT_TIMESTAMP),
    ('6540', 'IT-tjänster', CURRENT_TIMESTAMP),
    ('6570', 'Bankkostnader', CURRENT_TIMESTAMP),
    ('6990', 'Övriga externa kostnader', CURRENT_TIMESTAMP);

-- Posting defaults that used to be the ACCOUNT.* constants. Kept apart from
-- FortnoxConnection so disconnecting Fortnox doesn't discard them.
CREATE TABLE "BookkeepingSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "bankAccount" TEXT NOT NULL DEFAULT '1930',
    "memberDebtAccount" TEXT NOT NULL DEFAULT '2890',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookkeepingSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "BookkeepingSettings" ("id", "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP);
