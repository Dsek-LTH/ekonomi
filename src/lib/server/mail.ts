// Sending one email through the section's SMTP relay (SMTP_USER and SMTP_PASS only if it asks). Unset
// SMTP_HOST means mail is off: it is logged instead of sent.
import "server-only";

import { join } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { LOGO_CID } from "@/lib/email/render";
import { isProduction } from "@/lib/server/env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Sent alongside the text when present. See lib/email/render.ts. */
  html?: string | null;
}

// The section's mark, attached (not linked) to every HTML mail by content id, since clients block remote
// images and none draw SVG. In public/, which the production image keeps.
const LOGO = join(process.cwd(), "public", "email-logo.png");

/** Whether a relay is configured. */
export const mailEnabled = (): boolean => !!process.env.SMTP_HOST;

/** The address mail is sent from. Required with a relay, since a made-up sender gets binned. */
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
    // Implicit TLS on 465; elsewhere nodemailer upgrades with STARTTLS.
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
      ? {
          html: mail.html,
          attachments: [{ filename: "dsek.png", path: LOGO, cid: LOGO_CID }],
        }
      : {}),
  });
}
