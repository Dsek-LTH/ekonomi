// What an email says, before it is drawn: already in words (lib/server/notify.ts), drawn by render.tsx as HTML
// (components.tsx) and plain text (text.ts), so a fact added appears in both or neither.

export type Tone = "action" | "warning" | "card";

export interface Link {
  label: string;
  url: string;
}

export type Block =
  | {
      kind: "expense";
      reference: string | null;
      title: string;
      amount: string;
      facts: { label: string; value: string; tag?: TagTone }[];
    }
  | { kind: "comment"; author: string; when: string; text: string }
  | {
      kind: "transactions";
      head: { date: string; description: string; amount: string };
      refundLabel: string;
      rows: { date: string; description: string; amount: string; refund: boolean }[];
      more?: string;
    }
  | { kind: "stats"; items: { value: number; label: string; tone: "neutral" | Tone }[] }
  | {
      kind: "list";
      rows: { title: string; sub?: string; amount?: string; pill?: string }[];
      more?: string;
    }
  | {
      kind: "section";
      title: string;
      hint?: string;
      blocks: Block[];
      link?: Link;
      button?: Link;
    };

export type TagTone = "CARD" | "REIMBURSEMENT" | "MILEAGE";

export interface Email {
  subject: string;
  tone: Tone;
  eyebrow: string;
  heading: string;
  intro?: string;
  blocks: Block[];
  action?: Link;
  orOpen?: string;
  footer: { reason: string; settings: Link; org: string };
  brand: { name: string; org: string };
}

export const LOGO_CID = "logo@ekonomi";
