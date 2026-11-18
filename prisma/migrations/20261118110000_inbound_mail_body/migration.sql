-- The mail's text, kept so triage can read it in the Inkorg.
ALTER TABLE "InboundMail" ADD COLUMN "body" TEXT;
