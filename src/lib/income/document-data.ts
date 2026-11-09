// What an intäktsräkning says, as plain data for the typesetter.
//
// The contract between the app and lib/income/intakt.typ, and deliberately dull
// in the same way as the expense cover's (lib/expense/cover/types.ts): strings,
// already in Swedish and already formatted, so the template only places them.
// That is also what makes the interesting half testable without a renderer:
// which verksamhet a line is listed under, what the distribution table sums,
// what a fee reads as.
//
// One document per day and source, matching the voucher it substantiates. Each
// verksamhet that sold something gets a section of its own with its sum, its
// products grouped by account under a heading with the account's sum, the
// day's Zettle fees get one after them, and the distribution table is the
// voucher's rows in words: one per account and cost centre.
import { formatNumber } from "@/lib/ui/format";
import { byCodePoint, productRows } from "./product-groups";

/** One sold line, as the document is built from it. Amounts in öre. */
export interface DocumentSourceLine {
  kind: "SALE" | "FEE";
  /** The verksamhet as the document names it. Null on a fee. */
  unitName: string | null;
  name: string;
  variant: string | null;
  account: string;
  accountName: string;
  costCenter: { code: string; name: string } | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface DocumentSource {
  source: "ZETTLE" | "SWISH";
  /** ISO date of the day sold. */
  date: string;
  /** ISO date the document was made. */
  created: string;
  /** Who reviewed the day against this document and approved it. */
  attestation: { name: string; studentId: string | null };
  lines: readonly DocumentSourceLine[];
}

type DocumentRow =
  | { kind: "group"; name: string }
  | {
      kind: "line";
      label: string;
      indented: boolean;
      quantity: string;
      unitPrice: string;
      discount: string;
      total: string;
    };

/** One account inside a section, with its sum, as the review screen groups it. */
interface DocumentAccount {
  account: string;
  name: string;
  total: string;
  rows: DocumentRow[];
}

interface DocumentSection {
  title: string;
  total: string;
  accounts: DocumentAccount[];
}

export interface IncomeDocumentData {
  paymentType: "Zettle" | "Swish";
  date: string;
  created: string;
  attestation: { name: string; studentId: string };
  /** One per verksamhet that sold something, by name. */
  sections: DocumentSection[];
  /** The day's Zettle fees, or null on a day with none. */
  fees: DocumentSection | null;
  /** The voucher's rows in words: one per account and cost centre. */
  distribution: { account: string; name: string; costCenter: string; amount: string }[];
  salesTotal: string;
  /** What the clearing account moves by: sales less fees. */
  total: string;
  /** Whether any line carries a discount, which is when the column is drawn. */
  discounts: boolean;
}

/** "1 234,50": the unit is said once in each column's heading. */
const kr = (ore: number) => formatNumber(ore / 100, 2, 2);

const rowsOf = (lines: readonly DocumentSourceLine[]): DocumentRow[] =>
  productRows(lines).map((row) =>
    row.kind === "group"
      ? { kind: "group", name: row.name }
      : {
          kind: "line",
          label: row.label,
          indented: row.indented,
          quantity: String(row.line.quantity),
          unitPrice: kr(row.line.unitPrice),
          discount: row.line.discount ? kr(row.line.discount) : "",
          total: kr(row.line.total),
        },
  );

const sum = (lines: readonly DocumentSourceLine[]) => lines.reduce((s, l) => s + l.total, 0);

/**
 * A section's lines by account, in account order, each with its sum: the same
 * grouping as the sold-lines table on the review screen
 * (lib/income/sold-lines.ts), so the page and the screen read alike.
 */
function accountsOf(lines: readonly DocumentSourceLine[]): DocumentAccount[] {
  const byAccount = new Map<string, DocumentSourceLine[]>();
  for (const line of lines) {
    const group = byAccount.get(line.account);
    if (group) group.push(line);
    else byAccount.set(line.account, [line]);
  }
  return [...byAccount.keys()].sort(byCodePoint).map((account) => {
    const group = byAccount.get(account)!;
    return {
      account: account || "-",
      name: group[0].accountName,
      total: kr(sum(group)),
      rows: rowsOf(group),
    };
  });
}

export function buildIncomeDocumentData(source: DocumentSource): IncomeDocumentData {
  const sales = source.lines.filter((l) => l.kind === "SALE");
  const fees = source.lines.filter((l) => l.kind === "FEE");

  // Verksamheter by name, in the order a reader would look one up.
  const byUnit = new Map<string, DocumentSourceLine[]>();
  for (const line of sales) {
    const unit = line.unitName ?? "";
    const group = byUnit.get(unit);
    if (group) group.push(line);
    else byUnit.set(unit, [line]);
  }
  const sections = [...byUnit.keys()]
    .sort((a, b) => a.localeCompare(b, "sv"))
    .map((unit) => {
      const lines = byUnit.get(unit)!;
      return { title: unit || "-", total: kr(sum(lines)), accounts: accountsOf(lines) };
    });

  // The same grouping the voucher makes (lib/income/voucher.ts), so the table
  // and the verifikation beside it list the same rows with the same figures.
  const byRow = new Map<
    string,
    { account: string; name: string; costCenter: string; total: number }
  >();
  for (const line of source.lines) {
    const cc = line.costCenter ? `${line.costCenter.code} - ${line.costCenter.name}` : "-";
    const key = `${line.account}|${cc}`;
    const row = byRow.get(key);
    if (row) row.total += line.total;
    else byRow.set(key, { account: line.account, name: line.accountName, costCenter: cc, total: line.total });
  }
  const distribution = [...byRow.values()]
    .filter((r) => r.total !== 0)
    .sort((a, b) => byCodePoint(a.account, b.account) || byCodePoint(a.costCenter, b.costCenter))
    .map((r) => ({ account: r.account, name: r.name, costCenter: r.costCenter, amount: kr(r.total) }));

  return {
    paymentType: source.source === "SWISH" ? "Swish" : "Zettle",
    date: source.date,
    created: source.created,
    attestation: {
      name: source.attestation.name,
      studentId: source.attestation.studentId?.trim() || "-",
    },
    sections,
    fees:
      fees.length > 0
        ? { title: "Zettleavgifter", total: kr(sum(fees)), accounts: accountsOf(fees) }
        : null,
    distribution,
    salesTotal: kr(sum(sales)),
    total: kr(sum(source.lines)),
    discounts: source.lines.some((l) => l.discount !== 0),
  };
}
