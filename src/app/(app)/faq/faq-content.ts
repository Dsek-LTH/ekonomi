import type { Locale } from "@/i18n/request";

// The FAQ text lives in messages/<locale>/faq-content/<category>.json rather
// than in the app's main message catalogue, and is loaded here by the route
// that shows it. Every top-level namespace in messages/<locale>/ is serialised
// into NextIntlClientProvider on every page in the app, and 20-odd
// multi-paragraph answers is not something the expense list should be paying
// for. The page's chrome (its title, the search field, the empty state) is
// normal UI text and stays in the catalogue, in messages/<locale>/faq.json.
// The `-content` suffix keeps that file and this folder apart at a glance.
//
// One file per category rather than one array for the whole FAQ, so a specific
// section's answers can be found by filename. CATEGORIES fixes both the file
// list and the order the page shows them in.
const CATEGORIES = [
  "basics",
  "expenses",
  "reporting",
  "card",
  "mileage",
  "receipts",
  "examples-valid",
  "examples-invalid",
  "invoices",
  "payout",
  "approval",
  "budget",
] as const;
//
// The rules themselves come from Policy för ekonomi (the section's policy
// document), and only the parts that touch what is done in this app: buying,
// receipts, attest and the budget. The policy's sections on capital and the
// annual accounts are deliberately not here.
//
// An answer is a list of blocks rather than one string, because the source
// material ("HOW TO UTLÄGG", Skattmästare 2026) is not prose all
// the way down: the alcohol split is a worked example with a table, and the
// receipt requirements are a checklist. Flattening those into paragraphs is
// what makes an FAQ unreadable.
export type FaqBlock =
  | { t: "p"; v: string }
  | { t: "ul"; v: string[] }
  /** Numbered, for answers that are a sequence ("what do I do before I buy"). */
  | { t: "ol"; v: string[] }
  /** The one thing in the answer you get in trouble for missing. */
  | { t: "note"; tone: "warn" | "danger"; v: string }
  | { t: "table"; head: string[]; rows: string[][] }
  /** An inline link; `href` may be external or a `tel:`. */
  | { t: "link"; v: string; href: string }
  /** The answer's "…and here is where you do it": an in-app route, as a button. */
  | { t: "action"; v: string; href: string }
  /**
   * A receipt to look at rather than a rule to read. Half of what makes a
   * receipt invalid is visual (a cropped edge, a missing footer) and no
   * wording of the requirement teaches that as fast as one photo of it going
   * wrong. The content carries a basename; `src` and `expected` are filled in
   * by the page once it has looked for the file (see page.tsx).
   */
  | {
      t: "image";
      /** Basename under public/faq/receipts/, extension left open. */
      file: string;
      alt: string;
      /** null until someone puts the photo in public/faq/receipts/. */
      src?: string | null;
      /** What that file should be called, shown while it is missing. */
      expected?: string;
    };

export interface FaqItem {
  /** Stable across locales: it is the anchor, so /faq#deadline can be linked. */
  id: string;
  q: string;
  a: FaqBlock[];
}

export interface FaqSection {
  id: string;
  label: string;
  items: FaqItem[];
}

export async function loadFaq(locale: Locale): Promise<FaqSection[]> {
  const modules = await Promise.all(
    CATEGORIES.map((id) => import(`../../../../messages/${locale}/faq-content/${id}.json`)),
  );
  return modules.map((m) => m.default as FaqSection);
}

/** Everything in an answer that is words, for the search field to match on. */
function blockText(block: FaqBlock): string[] {
  switch (block.t) {
    case "ul":
    case "ol":
      return block.v;
    case "table":
      return [...block.head, ...block.rows.flat()];
    // The alt text describes the photo, which is what someone searching for
    // "beskuren" or "kortterminal" is actually looking for.
    case "image":
      return [block.alt];
    default:
      return [block.v];
  }
}

/**
 * One lowercased haystack per question. Searching the answers too, not just the
 * questions: someone types "pant" or "60 dagar", which is language from the
 * answer. The question is where they'd have had to guess our wording.
 */
export function searchText(item: FaqItem): string {
  return [item.q, ...item.a.flatMap(blockText)].join(" ").toLowerCase();
}
