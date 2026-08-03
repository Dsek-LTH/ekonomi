// Parser for Fortnox SIE type-4 exports (the whole general ledger for one
// financial year). SIE is a Swedish accounting interchange format: line-based,
// CP437-encoded ("#FORMAT PC8"), with quoted strings and {dimension object}
// lists. We only need the chart (#KONTO), cost-centre objects (#OBJEKT dim 1),
// and the vouchers (#VER) with their postings (#TRANS).

// CP437 high half (0x80–0xFF) → Unicode. The low half is ASCII. This is what
// turns "Kostnadsstlle" back into "Kostnadsställe".
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

export function decodeCp437(buf: Buffer): string {
  let out = "";
  for (const byte of buf) {
    out += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
  }
  return out;
}

// Split one SIE line into tokens. Quoted strings ("…") become one token with
// the quotes stripped; brace groups ({…}) become one token keeping the braces
// (so the caller can tell them apart and parse the inside).
function tokenize(line: string): string[] {
  const out: string[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const ch = line[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === '"') {
      let s = "";
      let j = i + 1;
      while (j < n && line[j] !== '"') s += line[j++];
      out.push(s);
      i = j + 1;
      continue;
    }
    if (ch === "{") {
      let s = "";
      let j = i + 1;
      while (j < n && line[j] !== "}") s += line[j++];
      out.push("{" + s + "}");
      i = j + 1;
      continue;
    }
    let s = "";
    let j = i;
    while (j < n && line[j] !== " " && line[j] !== "\t") s += line[j++];
    out.push(s);
    i = j;
  }
  return out;
}

// Pull the cost-centre code (SIE dimension 1) out of a {…} object list such as
// `{1 "SEKT06"}` or `{1 "X" 6 "Y"}`. Returns undefined for `{}`.
function costCenterFromObjects(brace: string): string | undefined {
  const inner = brace.slice(1, -1).trim();
  if (!inner) return undefined;
  const toks = tokenize(inner);
  for (let k = 0; k + 1 < toks.length; k += 2) {
    if (toks[k] === "1") return toks[k + 1] || undefined;
  }
  return undefined;
}

export interface SieTransaction {
  account: string;
  costCenterCode?: string;
  amount: number; // SEK decimal; positive = debit, negative = credit
  text?: string;
}

export interface SieVoucher {
  series: string;
  number: number;
  date: string; // YYYY-MM-DD
  description: string;
  transactions: SieTransaction[];
}

export interface ParsedSie {
  accounts: Map<string, string>; // account number → name
  costCenters: Map<string, string>; // dim-1 code → name
  vouchers: SieVoucher[];
  // Balance-sheet account balances for THIS financial year (#IB/#UB year index
  // 0). Same sign convention as transactions: positive = debit. Only balance
  // accounts (1xxx–2xxx) carry these; result accounts start each year at zero.
  //
  // Keyed `${account}|${costCenterCode}`, where an empty cost centre is the
  // account-level total from #IB/#UB. Per-cost-centre entries come from
  // #OIB/#OUB, which an exporter may omit entirely — callers must treat them
  // as optional detail, never as the source of the account total.
  openingBalances: Map<string, number>; // → SEK at year start
  closingBalances: Map<string, number>; // → SEK at year end
}

const balanceKey = (account: string, costCenterCode?: string | null) =>
  `${account}|${costCenterCode ?? ""}`;

function sieDate(raw: string): string {
  // YYYYMMDD → YYYY-MM-DD
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function parseSie(text: string): ParsedSie {
  const accounts = new Map<string, string>();
  const costCenters = new Map<string, string>();
  const vouchers: SieVoucher[] = [];
  const openingBalances = new Map<string, number>();
  const closingBalances = new Map<string, number>();
  let current: SieVoucher | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === "}") {
      current = null;
      continue;
    }
    if (line[0] === "{") continue; // block opener

    const t = tokenize(line);
    switch (t[0]) {
      case "#KONTO":
        if (t[1]) accounts.set(t[1], t[2] ?? t[1]);
        break;
      case "#OBJEKT":
        // #OBJEKT <dim> "<code>" "<name>"  — only dimension 1 is cost centre
        if (t[1] === "1" && t[2]) costCenters.set(t[2], t[3] ?? t[2]);
        break;
      case "#IB":
      case "#UB": {
        // #IB|#UB <yearIndex> <account> <balance> [<quantity>]
        // yearIndex 0 is this financial year, -1 the one before it; we only
        // mirror the year being synced, so anything else is skipped.
        if (t[1] !== "0") break;
        const account = t[2] ?? "";
        const balance = Number(t[3] ?? 0);
        if (!account || Number.isNaN(balance)) break;
        (t[0] === "#IB" ? openingBalances : closingBalances).set(balanceKey(account), balance);
        break;
      }
      case "#OIB":
      case "#OUB": {
        // #OIB|#OUB <yearIndex> <account> {<objects>} <balance> [<quantity>]
        // The same balance broken down per object. Optional in SIE, so its
        // absence just means no per-cost-centre detail is available.
        if (t[1] !== "0") break;
        const account = t[2] ?? "";
        const cc = costCenterFromObjects(t[3] ?? "{}");
        const balance = Number(t[4] ?? 0);
        if (!account || !cc || Number.isNaN(balance)) break;
        (t[0] === "#OIB" ? openingBalances : closingBalances).set(
          balanceKey(account, cc),
          balance,
        );
        break;
      }
      case "#VER": {
        // #VER <series> <number> <date> "<text>" <regdate>
        current = {
          series: t[1] ?? "",
          number: Number(t[2] ?? 0),
          date: sieDate(t[3] ?? ""),
          description: t[4] ?? "",
          transactions: [],
        };
        vouchers.push(current);
        break;
      }
      case "#TRANS": {
        // #TRANS <account> {<objects>} <amount> [<transdate>] [<text>] [<qty>]
        if (!current) break;
        const account = t[1] ?? "";
        const brace = t[2] ?? "{}";
        const amount = Number(t[3] ?? 0);
        const text = t[5] || undefined;
        if (!account || Number.isNaN(amount)) break;
        current.transactions.push({
          account,
          costCenterCode: costCenterFromObjects(brace),
          amount,
          text,
        });
        break;
      }
      // #RTRANS/#BTRANS (correction registrations) are intentionally ignored —
      // Fortnox emits the live posting as #TRANS.
    }
  }

  return { accounts, costCenters, vouchers, openingBalances, closingBalances };
}
