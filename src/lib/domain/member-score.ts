// Redovisningsbetyg: 0 to 100, the plain average of up to four 0 to 100 sub-scores: promptness and
// firstTime (as submitter), attestAccuracy and attestSpeed (as attester). A sub-score with fewer than
// MIN_COUNTED items is left out of the average. Not-yet-done items count as done today, so they cost
// more every day they wait. The submit clock starts when the member could first send: the purchase
// day, or for a card purchase the later of purchase and bank import. The attest clock starts when
// the record reached the attester. Visibility: canViewMemberScores.
import type { PaymentType } from "@/lib/domain/types";

/** How far back the score looks, in days. Rolling. */
export const SCORE_WINDOW_DAYS = 365;

/** Older than this, an item weighs half: recent habits count for more. */
const RECENT_DAYS = 182;

/** A purchase not sent yet is not late until this many days have passed. */
const SUBMIT_GRACE_DAYS = 7;

/** An attest not given yet is not late until this many days have passed. */
const ATTEST_GRACE_DAYS = 3;

/** Fewer items than this and a sub-score is left out of the average. */
export const MIN_COUNTED = 3;

/** Every timed sub-score starts as if with one item at this, so the first slow one does not drop a member to the bottom. */
const PRIOR = { points: 80, weight: 1 };

/** Every share starts as if with this many that went right: one early send-back is not a 0. */
const PRIOR_CLEAN = 2;

/** Points along a line through (days, points), flat past either end. */
function along(curve: readonly (readonly [number, number])[], days: number): number {
  if (days <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [d1, p1] = curve[i];
    if (days <= d1) {
      const [d0, p0] = curve[i - 1];
      return Math.round(p0 + ((p1 - p0) * (days - d0)) / (d1 - d0));
    }
  }
  return curve[curve.length - 1][1];
}

/** The points one purchase earns for the days it waited before it was sent. Full marks within a week, nothing past four months. */
export const submitPoints = (days: number) =>
  along(
    [
      [7, 100],
      [14, 80],
      [30, 60],
      [60, 40],
      [120, 0],
    ],
    days,
  );

/** The points one attest earns for the days the record waited. Full marks within three days, nothing past two months. */
export const attestPoints = (days: number) =>
  along(
    [
      [3, 100],
      [7, 80],
      [14, 60],
      [30, 40],
      [60, 0],
    ],
    days,
  );

/** One of the member's utlägg, as the score reads it. */
export interface ScoreExpense {
  id: string;
  title: string;
  paymentType: PaymentType;
  /** YYYY-MM-DD the clock started (see the top of the file). Null for a card purchase whose bank row is not in the app yet. */
  startedOn: string | null;
  /** YYYY-MM-DD it was first sent for attest. A recall and a resend do not restart it. */
  submittedOn: string | null;
  /** Sent back at least once, or its date corrected at the kontering (lib/domain/correction.ts). */
  returned: boolean;
  /** Judged: attested in full or sent back. */
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

export type AttestRecord = "expense" | "invoice";

/** One attest by the member, or one waiting on them. `outcome`: `correct` once bokförd/sent to Fortnox with the signature on, `returned` when the treasury sent it back after full attest or corrected its date, `open` otherwise (including recalls and other attesters' send-backs). */
export interface ScoreAttest {
  record: AttestRecord;
  id: string;
  title: string;
  /** YYYY-MM-DD it reached the member to sign. */
  readyOn: string;
  /** YYYY-MM-DD they signed. Null while it waits on them. */
  signedOn: string | null;
  outcome: "correct" | "returned" | "open";
}

/** One line of a timed breakdown. */
export interface ScoreItem {
  kind: "submitted" | "draft" | "cardPurchase" | "attested" | "attestWaiting";
  /** For an attest, what it was given on. */
  record?: AttestRecord;
  id: string;
  title: string;
  startedOn: string;
  /** How long it waited, or for one not done, has waited so far. */
  days: number;
  points: number;
}

export type SubScoreKey = "promptness" | "firstTime" | "attestAccuracy" | "attestSpeed";
export const SUB_SCORES: readonly SubScoreKey[] = [
  "promptness",
  "firstTime",
  "attestAccuracy",
  "attestSpeed",
];

export interface SubScore {
  /** 0 to 100, or null while fewer than MIN_COUNTED items count. */
  value: number | null;
  /** How many items it is made of. */
  counted: number;
}

export interface MemberScore {
  /** 0 to 100: the average of the sub-scores that have a value. Null while none has. */
  score: number | null;
  parts: Record<SubScoreKey, SubScore>;
  /** Of the judged utlägg, how many went through without being sent back. */
  firstTime: { clean: number; of: number };
  /** Of the settled attests, how many the treasury did not send back. */
  accuracy: { correct: number; of: number };
  /** Every purchase counted, the slowest first. */
  items: ScoreItem[];
  /** What is waiting to be sent now, the longest first. */
  waiting: ScoreItem[];
  /** Every attest counted, the slowest first. */
  attests: ScoreItem[];
  /** What is waiting on the member's attest now, the longest first. */
  attestWaiting: ScoreItem[];
  /** The attests the treasury sent back, the latest first. */
  returnedAttests: ScoreAttest[];
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.max(
    0,
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS),
  );

/** The recency-weighted average of the items' points, with the prior. */
function timed(items: readonly ScoreItem[], today: string): SubScore {
  let sum = PRIOR.points * PRIOR.weight;
  let weight = PRIOR.weight;
  for (const i of items) {
    const w = daysBetween(i.startedOn, today) <= RECENT_DAYS ? 1 : 0.5;
    sum += i.points * w;
    weight += w;
  }
  return {
    value: items.length < MIN_COUNTED ? null : Math.round(sum / weight),
    counted: items.length,
  };
}

/** The share that went right, with the prior. */
function share(clean: number, of: number): SubScore {
  return {
    value: of < MIN_COUNTED ? null : Math.round((100 * (clean + PRIOR_CLEAN)) / (of + PRIOR_CLEAN)),
    counted: of,
  };
}

const slowestFirst = (a: ScoreItem, b: ScoreItem) =>
  b.days - a.days || a.startedOn.localeCompare(b.startedOn);

/** One member's score, as of `today` (YYYY-MM-DD). */
export function memberScore(input: {
  today: string;
  expenses: readonly ScoreExpense[];
  cardPurchases: readonly ScoreCardPurchase[];
  attests?: readonly ScoreAttest[];
}): MemberScore {
  const { today } = input;
  const inWindow = (day: string) => daysBetween(day, today) <= SCORE_WINDOW_DAYS && day <= today;

  const items: ScoreItem[] = [];
  for (const e of input.expenses) {
    if (!e.startedOn || !inWindow(e.startedOn)) continue;
    const days = daysBetween(e.startedOn, e.submittedOn ?? today);
    // Not sent and still inside the grace days: nothing is late yet.
    if (!e.submittedOn && days <= SUBMIT_GRACE_DAYS) continue;
    items.push({
      kind: e.submittedOn ? "submitted" : "draft",
      id: e.id,
      title: e.title,
      startedOn: e.startedOn,
      days,
      points: submitPoints(days),
    });
  }
  for (const p of input.cardPurchases) {
    if (!inWindow(p.startedOn)) continue;
    const days = daysBetween(p.startedOn, today);
    if (days <= SUBMIT_GRACE_DAYS) continue;
    items.push({
      kind: "cardPurchase",
      id: p.id,
      title: p.description,
      startedOn: p.startedOn,
      days,
      points: submitPoints(days),
    });
  }
  items.sort(slowestFirst);

  const judged = input.expenses.filter((e) => e.judged && e.startedOn && inWindow(e.startedOn));
  const firstTime = { clean: judged.filter((e) => !e.returned).length, of: judged.length };

  // Attests: timed by when they were given, or for one waiting, from when it reached the member.
  const attests: ScoreItem[] = [];
  const settled: ScoreAttest[] = [];
  for (const a of input.attests ?? []) {
    const days = daysBetween(a.readyOn, a.signedOn ?? today);
    if (!inWindow(a.signedOn ?? a.readyOn)) continue;
    if (a.outcome !== "open") settled.push(a);
    if (!a.signedOn && days <= ATTEST_GRACE_DAYS) continue;
    attests.push({
      kind: a.signedOn ? "attested" : "attestWaiting",
      record: a.record,
      id: a.id,
      title: a.title,
      startedOn: a.readyOn,
      days,
      points: attestPoints(days),
    });
  }
  attests.sort(slowestFirst);
  const returnedAttests = settled
    .filter((a) => a.outcome === "returned")
    .sort((a, b) => (b.signedOn ?? "").localeCompare(a.signedOn ?? ""));
  const accuracy = { correct: settled.length - returnedAttests.length, of: settled.length };

  const parts: Record<SubScoreKey, SubScore> = {
    promptness: timed(items, today),
    firstTime: share(firstTime.clean, firstTime.of),
    attestAccuracy: share(accuracy.correct, accuracy.of),
    attestSpeed: timed(attests, today),
  };
  const values = SUB_SCORES.map((k) => parts[k].value).filter((v): v is number => v !== null);
  const score = values.length
    ? Math.round(values.reduce((s, v) => s + v, 0) / values.length)
    : null;

  return {
    score,
    parts,
    firstTime,
    accuracy,
    items,
    waiting: items.filter((i) => i.kind === "draft" || i.kind === "cardPurchase"),
    attests,
    attestWaiting: attests.filter((i) => i.kind === "attestWaiting"),
    returnedAttests,
  };
}

// ── Reading attests off a record's history ────────────────────────────────

/** One event on an utlägg or a faktura, as the attest walk reads it. */
export interface AttestEvent {
  type: string;
  actorId: string | null;
  /** YYYY-MM-DD. */
  on: string;
  /** An ATTEST_WITHDRAWN that took every signature off (a faktura's split changed). */
  all?: boolean;
  /** A CORRECTED that counts against the attesters (isFaultedCorrection). */
  faulted?: boolean;
}

/** A signature given in the current round, not yet settled. */
interface Signed {
  readyOn: string;
  signedOn: string;
}

/** Every attest on one record, by who gave it, from its events oldest first. A round starts when the record is put in front of the attesters and ends with: bokförd/sent to Fortnox (all `correct`); sent back after full attest or date corrected at the kontering (all `returned`, the correction can come just before the BOOKED or in a later amend, so both orders are read); sent back earlier or recalled (`open`); a signature taken back by its own attester is dropped. */
export function attestsFromEvents(
  record: AttestRecord,
  events: readonly AttestEvent[],
): { actorId: string; readyOn: string; signedOn: string; outcome: ScoreAttest["outcome"] }[] {
  const out: ReturnType<typeof attestsFromEvents> = [];
  let readyOn: string | null = null;
  let round = new Map<string, Signed>();
  let fullyAttested = false;
  // A faulted correction seen while the round is still open.
  let corrected = false;
  // Where in `out` the last round settled `correct` starts, so a later correction can turn it round.
  let lastCorrect: number | null = null;

  const settle = (outcome: ScoreAttest["outcome"]) => {
    if (outcome === "correct" && corrected) outcome = "returned";
    lastCorrect = outcome === "correct" && round.size > 0 ? out.length : null;
    for (const [actorId, s] of round) out.push({ actorId, ...s, outcome });
    round = new Map();
    fullyAttested = false;
    corrected = false;
  };
  const final = record === "expense" ? "BOOKED" : "EXPORTED";

  for (const e of events) {
    switch (e.type) {
      case "SUBMITTED":
      case "ASSIGNED":
        settle("open");
        readyOn = e.on;
        break;
      case "COST_CENTER_APPROVED":
        if (e.actorId && !round.has(e.actorId)) {
          round.set(e.actorId, { readyOn: readyOn ?? e.on, signedOn: e.on });
        }
        // A faktura goes from one unit to the next: a later signer could only start once this one signed.
        if (record === "invoice") readyOn = e.on;
        break;
      case "ATTEST_WITHDRAWN":
        fullyAttested = false;
        if (e.all) {
          round = new Map();
          readyOn = e.on;
        } else if (e.actorId) {
          round.delete(e.actorId);
        }
        break;
      case "APPROVED":
        fullyAttested = true;
        break;
      case "CHANGES_REQUESTED":
        settle(fullyAttested ? "returned" : "open");
        // A faktura goes straight back to its unit. An utlägg waits for its submitter to send it again.
        readyOn = record === "invoice" ? e.on : null;
        break;
      case "RECALLED":
        settle("open");
        readyOn = null;
        break;
      case "CORRECTED":
        if (!e.faulted) break;
        if (fullyAttested) {
          corrected = true;
        } else if (lastCorrect !== null) {
          for (let i = lastCorrect; i < out.length; i++) out[i].outcome = "returned";
          lastCorrect = null;
        }
        break;
      case final:
        settle("correct");
        break;
    }
  }
  settle("open");
  return out;
}
