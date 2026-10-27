-- The revisor role, and the capability that lets it read the books without
-- working them. See BOOKKEEPING_VIEW in auth.prisma.

-- AlterEnum
ALTER TYPE "Capability" ADD VALUE 'BOOKKEEPING_VIEW';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'REVISOR';
