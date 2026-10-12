// What an email says, before it is drawn.
//
// Everything here is already in words: lib/server/notify.ts does the
// translating and fills one of these in, and render.tsx draws it twice, as
// HTML (components.tsx) and as plain text (text.ts). Keeping the content apart
// from both drawings is what keeps them saying the same thing: a fact added to
// an utlägg's summary appears in both or in neither.

/** The colour of the line along the top of the card, and of the eyebrow. */
export type Tone = "action" | "warning" | "card";

export interface Link {
  label: string;
  url: string;
}

export type Block =
  /** The utlägg the mail is about: reference, title, amount, and a few facts. */
  | {
      kind: "expense";
      reference: string | null;
      title: string;
      amount: string;
      facts: { label: string; value: string; tag?: TagTone }[];
    }
  /** What somebody wrote when they acted, quoted. */
  | { kind: "comment"; author: string; when: string; text: string }
  /** Bank rows: date, description, amount, refunds marked. */
  | {
      kind: "transactions";
      head: { date: string; description: string; amount: string };
      refundLabel: string;
      rows: { date: string; description: string; amount: string; refund: boolean }[];
      more?: string;
    }
  /** A row of counters at the top of the digest. */
  | { kind: "stats"; items: { value: number; label: string; tone: "neutral" | Tone }[] }
  /** Items with a title, a line under it, and an amount or a pill on the right. */
  | {
      kind: "list";
      rows: { title: string; sub?: string; amount?: string; pill?: string }[];
      more?: string;
    }
  /** A titled part of the digest, with its own content and where to go next. */
  | {
      kind: "section";
      title: string;
      hint?: string;
      blocks: Block[];
      link?: Link;
      button?: Link;
    };

/** The coloured payment-type tags the app draws, by payment type. */
export type TagTone = "CARD" | "REIMBURSEMENT" | "MILEAGE";

export interface Email {
  subject: string;
  tone: Tone;
  eyebrow: string;
  heading: string;
  intro?: string;
  blocks: Block[];
  action?: Link;
  /** "Eller öppna länken: …", under the button, for clients that hide it. */
  orOpen?: string;
  footer: { reason: string; settings: Link; org: string };
  brand: { name: string; org: string };
}

/** The content id the logo is attached under. See lib/server/mail.ts. */
export const LOGO_CID = "logo@utlagg";
