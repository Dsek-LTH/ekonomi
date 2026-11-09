// Parser for Fortnox SIE type-4 exports (one financial year's ledger): line-based, CP437,
// quoted strings and {dimension object} lists. Reads #KONTO, #OBJEKT dim 1 (cost centres),
// #VER and #TRANS.

// CP437 high half (0x80-0xFF) → Unicode. The low half is ASCII. This is what
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

// Cost-centre code (SIE dimension 1) from a {…} object list, undefined for `{}`.
function costCenterFromObjects(brace: string): string | undefined {
  const inner = brace.slice(1, -1).trim();
  if (!inner) return undefined;
  const toks = tokenize(inner);
  for (let k = 0; k + 1 < toks.length; k += 2) {
    if (toks[k] === "1") return toks[k + 1] || undefined;
  }
  return undefined;
}

interface SieTransaction {
  account: string;
  costCenterCode?: string;
  amount: number; // SEK decimal; positive = debit, negative = credit
  text?: string;
}

interface SieVoucher {
  series: string;
  number: number;
  date: string; // YYYY-MM-DD
  description: string;
  transactions: SieTransaction[];
}

interface ParsedSie {
  accounts: Map<string, string>; // account number → name
  costCenters: Map<string, string>; // dim-1 code → name
  vouchers: SieVoucher[];
  // Balance-sheet balances for THIS year (#IB/#UB year index 0), positive = debit. Keyed
  // `${account}|${costCenterCode}`: empty cost centre is the account total, per-cost-centre
  // entries come from #OIB/#OUB (which an exporter may omit) and are optional detail only.
  openingBalances: Map<string, number>; // → SEK at year start
  closingBalances: Map<string, number>; // → SEK at year end
}

const balanceKey = (account: string, costCenterCode?: string | null) =>
  `${account}|${costCenterCode ?? ""}`;

function sieDate(raw: string): string {
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
        if (t[1] === "1" && t[2]) costCenters.set(t[2], t[3] ?? t[2]);
        break;
      case "#IB":
      case "#UB": {
        // #IB|#UB <yearIndex> <account> <balance> [<quantity>]
        // yearIndex 0 is this year, -1 the one before; only this year is mirrored.
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
        // Optional in SIE.
        if (t[1] !== "0") break;
        const account = t[2] ?? "";
        const cc = costCenterFromObjects(t[3] ?? "{}");
        const balance = Number(t[4] ?? 0);
        if (!account || !cc || Number.isNaN(balance)) break;
        (t[0] === "#OIB" ? openingBalances : closingBalances).set(balanceKey(account, cc), balance);
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
      // #RTRANS/#BTRANS (corrections) are ignored: Fortnox emits the live posting as #TRANS.
    }
  }

  return { accounts, costCenters, vouchers, openingBalances, closingBalances };
}
