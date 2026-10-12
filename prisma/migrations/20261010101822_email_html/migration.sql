-- The HTML version of each outbound mail, drawn beside the plain text one.

-- AlterTable
ALTER TABLE "OutboundEmail" ADD COLUMN     "html" TEXT;
