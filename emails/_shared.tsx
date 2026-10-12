// The React Email preview server (`pnpm email:preview`).
//
// Every preview is the sample mail from lib/email/samples.ts, drawn by the
// same code a sent mail is.
// The logo comes from emails/static (a link to public/email-logo.png), since a
// preview has no attachment for the `cid:` address a sent mail uses.
import { EmailDocument } from "@/lib/email/components";
import { sampleEmail } from "@/lib/email/samples";
import type { NotificationKind } from "@/lib/domain/types";

export const LOGO = "/static/email-logo.png";

export function KindPreview({ kind }: { kind: NotificationKind }) {
  return <EmailDocument email={sampleEmail(kind)} logoSrc={LOGO} />;
}
