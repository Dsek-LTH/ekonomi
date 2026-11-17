-- A role or a capability given to one member by hand, for a period or until removed.

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role",
    "capability" "Capability",
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id"),
    -- Exactly one thing granted per row.
    CONSTRAINT "AccessGrant_one_thing" CHECK (("role" IS NULL) <> ("capability" IS NULL)),
    -- A period that ends before it starts would grant nothing and say otherwise.
    CONSTRAINT "AccessGrant_period" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom")
);

-- CreateIndex
CREATE INDEX "AccessGrant_userId_idx" ON "AccessGrant"("userId");

-- CreateIndex
CREATE INDEX "AccessGrant_role_idx" ON "AccessGrant"("role");

-- CreateIndex
CREATE INDEX "AccessGrant_capability_idx" ON "AccessGrant"("capability");

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Granting is the skattmästare's by default, the way SETTINGS is.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES ('SKATTMASTARE', 'GRANT_ACCESS')
ON CONFLICT DO NOTHING;
