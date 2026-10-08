// The printed report, laid out the way Fortnox prints its resultat- and
// balansrapport.
//
// The screen groups accounts into the BAS sections of lib/ledger/bas, one level
// deep, which is what searching and drilling into rows wants. A printed report
// is read top to bottom by somebody comparing it with Fortnox's, so it follows
// Fortnox's structure instead: a heading per side ("Rörelsens intäkter"), the
// account classes under it with an "S:a" line each, and the intermediate
// results (Bruttovinst, Rörelseresultat, Resultat efter finansiella poster)
// where Fortnox puts them.
//
// Pure: a report group in, a list of lines out. Every figure is summed from the
// accounts, so the lines add up to whatever the screen's filters left in.
import type { ReportAccount, ReportGroup } from "./report-types";
import type { ReportKind } from "@/lib/ledger/bas";

/** The figures on one line. Nullable columns stay null when no account has one. */
export interface Figures {
  amount: number;
  opening: number | null;
  closing: number | null;
  comparison: number | null;
  accumulated: number | null;
  prior: number | null;
  priorAccumulated: number | null;
}

/**
 * One printed line. `label` is a key under `ledger.print.layout`. A `partTotal`
 * reads "S:a <part>", so it carries the part's key and not a label of its own.
 */
export type PrintLine =
  | { kind: "heading"; label: string }
  | { kind: "part"; label: string }
  | { kind: "account"; account: ReportAccount; partTotal: Figures }
  | { kind: "partTotal"; label: string; figures: Figures }
  | { kind: "total"; label: string; figures: Figures }
  | { kind: "result"; label: string; figures: Figures };

/** An account class: a range of BAS accounts printed under one name. */
interface Part {
  part: string;
  from: number;
  to: number;
}

/** A running result: everything from the report's first account up to `upTo`. */
interface Result {
  result: string;
  upTo: number;
  /** Printed only when this range has accounts (Resultat före skatt). */
  onlyIf?: { from: number; to: number };
}

interface Block {
  heading: string;
  items: (Part | Result)[];
  total: string;
}

const RESULT_LAYOUT: Block[] = [
  {
    heading: "rorelsensIntakter",
    items: [
      { part: "nettoomsattning", from: 3000, to: 3799 },
      { part: "aktiveratArbete", from: 3800, to: 3899 },
      { part: "ovrigaRorelseintakter", from: 3900, to: 3999 },
    ],
    total: "summaRorelsensIntakter",
  },
  {
    heading: "rorelsensKostnader",
    items: [
      { part: "ravaror", from: 4000, to: 4999 },
      { result: "bruttovinst", upTo: 4999 },
      { part: "externa", from: 5000, to: 6999 },
      { part: "personal", from: 7000, to: 7699 },
      { part: "avskrivningar", from: 7700, to: 7899 },
      { part: "ovrigaRorelsekostnader", from: 7900, to: 7999 },
      { result: "rorelseresultat", upTo: 7999 },
      { part: "finansiella", from: 8000, to: 8799 },
      { result: "resultatEfterFinansiella", upTo: 8799 },
      { part: "bokslutsdispositioner", from: 8800, to: 8899 },
      { result: "resultatForeSkatt", upTo: 8899, onlyIf: { from: 8800, to: 8999 } },
      { part: "skatter", from: 8900, to: 8999 },
    ],
    total: "summaRorelsensKostnader",
  },
];

const BALANCE_LAYOUT: Block[] = [
  {
    heading: "tillgangar",
    items: [
      { part: "anlaggning", from: 1000, to: 1399 },
      { part: "omsattning", from: 1400, to: 1999 },
    ],
    total: "summaTillgangar",
  },
  {
    heading: "egetKapitalOchSkulder",
    items: [
      { part: "egetkapital", from: 2000, to: 2099 },
      { part: "obeskattade", from: 2100, to: 2199 },
      { part: "avsattningar", from: 2200, to: 2299 },
      { part: "langfristiga", from: 2300, to: 2399 },
      { part: "kortfristiga", from: 2400, to: 2999 },
    ],
    total: "summaEgetKapitalOchSkulder",
  },
];

const isPart = (item: Part | Result): item is Part => "part" in item;

// Null only when every input is null, as on screen (see report-view's sumOf).
function sumNullable(accounts: ReportAccount[], get: (a: ReportAccount) => number | null) {
  return accounts.every((a) => get(a) == null)
    ? null
    : accounts.reduce((s, a) => s + (get(a) ?? 0), 0);
}

export function figuresOf(accounts: ReportAccount[]): Figures {
  return {
    amount: accounts.reduce((s, a) => s + a.amount, 0),
    opening: sumNullable(accounts, (a) => a.opening),
    closing: sumNullable(accounts, (a) => a.closing),
    comparison: sumNullable(accounts, (a) => a.comparison),
    accumulated: sumNullable(accounts, (a) => a.accumulated),
    prior: sumNullable(accounts, (a) => a.prior),
    priorAccumulated: sumNullable(accounts, (a) => a.priorAccumulated),
  };
}

/** One cost centre's report (or the whole report, when summed), as lines. */
export function printLines(group: ReportGroup, kind: ReportKind): PrintLine[] {
  const accounts = group.sections
    .flatMap((s) => s.accounts)
    .sort((a, b) => a.account.localeCompare(b.account));
  const within = (from: number, to: number) =>
    accounts.filter((a) => {
      const n = Number(a.account);
      return n >= from && n <= to;
    });

  const layout = kind === "BALANCE" ? BALANCE_LAYOUT : RESULT_LAYOUT;
  const first = layout[0].items.find(isPart)!.from;
  const lines: PrintLine[] = [];

  for (const block of layout) {
    lines.push({ kind: "heading", label: block.heading });
    const inBlock: ReportAccount[] = [];
    for (const item of block.items) {
      if (isPart(item)) {
        const list = within(item.from, item.to);
        if (list.length === 0) continue;
        inBlock.push(...list);
        const partTotal = figuresOf(list);
        lines.push({ kind: "part", label: item.part });
        for (const account of list) lines.push({ kind: "account", account, partTotal });
        lines.push({ kind: "partTotal", label: item.part, figures: partTotal });
      } else {
        if (item.onlyIf && within(item.onlyIf.from, item.onlyIf.to).length === 0) continue;
        lines.push({ kind: "result", label: item.result, figures: figuresOf(within(first, item.upTo)) });
      }
    }
    lines.push({ kind: "total", label: block.total, figures: figuresOf(inBlock) });
  }

  lines.push({ kind: "result", label: "beraknatResultat", figures: figuresOf(accounts) });
  return lines;
}
