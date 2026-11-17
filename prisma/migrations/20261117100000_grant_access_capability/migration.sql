-- Personal grants (AccessGrant). This migration only adds the enum value. The
-- table and the default holder are in the next one: Postgres will not let a
-- transaction use an enum value added by that same transaction.

ALTER TYPE "Capability" ADD VALUE 'GRANT_ACCESS';
