// Redovisningsbetyg: one to five stars for how promptly a member redovisar.
//
// It is there to make filing on time something worth doing, so it measures
// only what the member does and controls: how long a purchase waits before it
// is sent for attest, and whether it goes through first time. Not the amount,
// not how many, and not how long attest or bokföring take, which are other
// people's.
//
// Its one rule that matters most: what has NOT been sent counts too. A card
// purchase nobody has redovisat and a draft left lying are scored as though
// sent today, so they cost more every day they wait. Scoring only what was
// sent would make never sending look like a clean record.
//
// The clock starts when the member could first have sent it. For an eget
// utlägg or a milersättning that is the day of the purchase. A card purchase
// cannot be sent until its bank row is in the app to match (the treasury
// imports the statement by hand), so it starts on the later of the purchase
// and the import. A slow import is the treasury's delay, not the member's.
//
// No consequences hang on it. The treasury reads everyone's and a member their
// own (canViewMemberScores, and docs/navigation.md for where it is shown).
import type { PaymentType } from "@/lib/domain/types";

/** How far back the score looks, in days. Rolling, so a new year does not
 *  wipe out a habit, good or bad. */
export const SCORE_WINDOW_DAYS = 365;

/** Older than this, a purchase weighs half: recent habits count for more. */
const RECENT_DAYS = 182;

/** A purchase not sent yet is not late until this many days have passed. It
 *  is also the bar for five stars. */
export const GRACE_DAYS = 7;

/** Fewer counted purchases than this and there are no stars yet, only "new". */
export const MIN_COUNTED = 3;

/** Everybody starts as if with one purchase at four stars, so the first late
 *  one does not drop a new member straight to the bottom. */
const PRIOR = { stars: 4, weight: 1 };

/** How much of the score is going through attest first time. The rest is
 *  time to submit. */
const FIRST_TIME_WEIGHT = 0.15;

/** The stars one purchase earns for the days it waited before it was sent. */
export function starsForDays(days: number): 1 | 2 | 3 | 4 | 5 {
  if (days <= 7) return 5;
  if (days <= 14) return 4;
  if (days <= 30) return 3;
  if (days <= 60) return 2;
  return 1;
}

/** One of the member's utlägg, as the score reads it. */
export interface ScoreExpense {
  id: string;
  title: string;
  paymentType: PaymentType;
  /** YYYY-MM-DD the clock started (see the top of the file). Null when it has
   *  not: a card purchase whose bank row is not in the app yet. */
  startedOn: string | null;
  /** YYYY-MM-DD it was first sent for attest. A recall and a resend do not
   *  start it again. Null while it never has been. */
  submittedOn: string | null;
  /** Sent back for changes at least once. */
  returned: boolean;
  /** Somebody has judged it: attested in full or sent back. Only these say
   *  anything about going through first time. */
  judged: boolean;
}

/** A purchase on the member's section card that no utlägg settles yet. */
export interface ScoreCardPurchase {
  id: string;
  description: string;
  /** Öre, negative. */
  amount: number;
  /** YYYY-MM-DD: the later of the purchase and its bank row's import. */
  startedOn: string;
}

/** One line of the breakdown. */
export interface ScoreItem {
  kind: "submitted" | "draft" | "cardPurchase";
  id: string;
  title: string;
  startedOn: string;
  /** How long it waited, or for one not sent, has waited so far. */
  days: number;
  stars: 1 | 2 | 3 | 4 | 5;
}

export interface MemberScore {
  /** One to five in halves, or null while fewer than MIN_COUNTED count. */
  stars: number | null;
  /** How many purchases the score is made of. */
  counted: number;
  /** The time-to-submit part, one to five, unrounded. */
  timeliness: number;
  /** Of the judged ones, how many went through without being sent back. */
  firstTime: { clean: number; of: number };
  /** Every purchase counted, the slowest first. */
  items: ScoreItem[];
  /** What is waiting now, the longest first: what sending would raise. */
  waiting: ScoreItem[];
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS));

/** One member's score, as of `today` (YYYY-MM-DD). */
export function memberScore(input: {
  today: string;
  expenses: readonly ScoreExpense[];
  cardPurchases: readonly ScoreCardPurchase[];
}): MemberScore {
  const { today } = input;
  const inWindow = (day: string) => daysBetween(day, today) <= SCORE_WINDOW_DAYS && day <= today;

  const items: ScoreItem[] = [];
  for (const e of input.expenses) {
    if (!e.startedOn || !inWindow(e.startedOn)) continue;
    const days = daysBetween(e.startedOn, e.submittedOn ?? today);
    // Not sent and still inside the grace days: nothing is late yet, and
    // counting it at five stars would reward having just bought something.
    if (!e.submittedOn && days <= GRACE_DAYS) continue;
    items.push({
      kind: e.submittedOn ? "submitted" : "draft",
      id: e.id,
      title: e.title,
      startedOn: e.startedOn,
      days,
      stars: starsForDays(days),
    });
  }
  for (const p of input.cardPurchases) {
    if (!inWindow(p.startedOn)) continue;
    const days = daysBetween(p.startedOn, today);
    if (days <= GRACE_DAYS) continue;
    items.push({
      kind: "cardPurchase",
      id: p.id,
      title: p.description,
      startedOn: p.startedOn,
      days,
      stars: starsForDays(days),
    });
  }
  items.sort((a, b) => b.days - a.days || a.startedOn.localeCompare(b.startedOn));

  let sum = PRIOR.stars * PRIOR.weight;
  let weight = PRIOR.weight;
  for (const i of items) {
    const w = daysBetween(i.startedOn, today) <= RECENT_DAYS ? 1 : 0.5;
    sum += i.stars * w;
    weight += w;
  }
  const timeliness = sum / weight;

  const judged = input.expenses.filter((e) => e.judged && e.startedOn && inWindow(e.startedOn));
  const firstTime = { clean: judged.filter((e) => !e.returned).length, of: judged.length };
  // On the same one-to-five scale, and with the same kind of head start: two
  // that went through clean, so one sent back early on is not a 1.
  const share = (firstTime.clean + 2) / (firstTime.of + 2);
  const combined = (1 - FIRST_TIME_WEIGHT) * timeliness + FIRST_TIME_WEIGHT * (1 + 4 * share);

  const stars =
    items.length < MIN_COUNTED ? null : Math.min(5, Math.max(1, Math.round(combined * 2) / 2));

  return {
    stars,
    counted: items.length,
    timeliness,
    firstTime,
    items,
    waiting: items.filter((i) => i.kind !== "submitted"),
  };
}
