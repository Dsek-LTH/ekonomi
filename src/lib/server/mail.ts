// Sending one email, through the section's SMTP relay.
//
// The relay is the whole transport. It accepts mail from the cluster without
// credentials in the usual setup, which is why SMTP_USER and SMTP_PASS are
// optional: set them only if the relay asks for them.
//
// Unset SMTP_HOST means mail is off, a supported way to run like Fortnox and
// intakt are. Mail is then written to the log instead of being sent, which is
// what local development wants: every notification can be read in the
// terminal, and nobody in the section gets a test mail from a laptop.
import "server-only";

import { join } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { LOGO_CID } from "@/lib/email/render";

const isProduction = process.env.NODE_ENV === "production";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Sent alongside the text when present. See lib/email/render.ts. */
  html?: string | null;
}

// The section's mark, attached to every HTML mail and drawn from it by content
// id. Attached rather than linked: a mail client that blocks remote images
// (most do, until asked) still shows an attached one, and nothing depends on
// the app being reachable from wherever the mail is read. A PNG because no
// common client draws SVG. public/, since the production image keeps it.
const LOGO = join(process.cwd(), "public", "email-logo.png");

/** Whether a relay is configured. Off is not an error; see the note above. */
export const mailEnabled = (): boolean => !!process.env.SMTP_HOST;

/**
 * The address mail is sent from. Required with a relay, since a relay that
 * accepts anything will still have its mail binned by the receiving end if the
 * sender is made up.
 */
function sender(): string {
  const from = process.env.MAIL_FROM;
  if (from) return from;
  if (isProduction && mailEnabled()) throw new Error("MAIL_FROM är inte satt. Se .env.example.");
  return "Ekonomi <ekonomi@localhost>";
}

let transporter: Transporter | null = null;

function relay(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT || 25);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // Implicit TLS on 465. Anywhere else nodemailer upgrades with STARTTLS
    // when the relay offers it.
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
  });
  return transporter;
}

/** Send one mail, or log it when no relay is configured. Throws on failure. */
export async function sendMail(mail: Mail): Promise<void> {
  if (!mailEnabled()) {
    console.info(`[mail] till ${mail.to}: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  await relay().sendMail({
    from: sender(),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html
      ? { html: mail.html, attachments: [{ filename: "dsek.png", path: LOGO, cid: LOGO_CID }] }
      : {}),
  });
}
