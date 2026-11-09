import type { Locale } from "@/i18n/request";

// The FAQ text lives in messages/<locale>/faq-content/<category>.json, not the main catalogue, which is serialised into every page.
// The page's chrome stays in messages/<locale>/faq.json. One file per category; CATEGORIES fixes the file list and order.
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
// Rules come from Policy för ekonomi, only the parts that touch this app: buying, receipts, attest and the budget.
// An answer is a list of blocks, not one string: worked examples with tables and checklists.
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
  /** A receipt photo. The content carries a basename; `src` and `expected` are filled in by the page (see page.tsx). */
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

/** One lowercased haystack per question. Searches the answers too, not just the questions. */
export function searchText(item: FaqItem): string {
  return [item.q, ...item.a.flatMap(blockText)].join(" ").toLowerCase();
}
