// Parser for the budget interchange CSV: the format a past budget is brought
// into the app as.
//
// One row per budget line, carrying the sheet and account it belongs under, so
// the file is flat and the tree is rebuilt here:
//
//   cost_center,cc_name,account,account_name,description,quantity,unit_price,amount
//   SEX02,Sittningar,3015,Biljettförsäljning,T. sittningar,,,250000
//   SEX02,Sittningar,3011,Alkoholförsäljning,Öl,1.44,48431.89,
//
// Flat on purpose: these budgets arrive as spreadsheets whose structure differs
// from year to year, and no importer can be written once against all of them.
// What can be written once is the target, and the cheapest target to produce
// from an arbitrary layout is one row per line with its keys repeated.
//
// Amounts are kronor here (it is a file a person writes) and are converted to
// the expression strings the budget stores. Either `amount` or the
// `quantity`/`unit_price` pair is given, never both: that is the same rule the
// schema states on BudgetLineItem, and stating it twice is how the file's
// meaning survives the trip.
import { amountToOre, sniffDelimiter, splitCsvLine } from "@/lib/domain/csv";

export interface ParsedBudgetLine {
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  expression: string;
}

export interface ParsedBudgetAccount {
  code: string;
  name: string;
  lines: ParsedBudgetLine[];
}

export interface ParsedBudgetSheet {
  costCenterCode: string;
  costCenterName: string;
  accounts: ParsedBudgetAccount[];
}

export interface BudgetCsvProblem {
  line: number; // 1-based line number in the file, so an error can be found
  message: string;
}

export interface ParsedBudgetCsv {
  sheets: ParsedBudgetSheet[];
  problems: BudgetCsvProblem[];
}

// The columns, by header name. Order in the file is free: a person assembling
// one of these in Excel will move columns around, and there is no reason to
// care as long as the headings survive.
const REQUIRED = ["cost_center", "account", "description"] as const;
const OPTIONAL = ["cc_name", "account_name", "quantity", "unit_price", "amount"] as const;
const KNOWN: readonly string[] = [...REQUIRED, ...OPTIONAL];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");

/**
 * An account code as the budget stores it.
 *
 * Spreadsheets keep account numbers as numbers, so a code arrives as "3015.0"
 * as often as "3015", and a code that is not a bare number is dropped from the
 * Utfall comparison later on, silently, because that report resolves an account
 * to a section with Number(code). So the trailing ".0" is stripped here rather
 * than left for the report to trip over.
 */
export function normalizeAccountCode(raw: string): string | null {
  const s = raw.trim().replace(/\.0+$/, "");
  return /^\d{3,6}$/.test(s) ? s : null;
}

/**
 * An amount of money as an expression string, in kronor.
 *
 * Goes through öre so that "1 234,50" and "1234.50" mean the same thing, and so
 * that the result is money-precise. The budget is compared against the ledger
 * in öre (lib/ledger/comparison.ts), and a figure carrying more decimals than
 * that is claiming a precision the comparison cannot honour.
 */
function amountExpression(raw: string): string | null {
  const ore = amountToOre(raw);
  return ore === null ? null : String(ore / 100);
}

/**
 * A plain factor as an expression string.
 *
 * Deliberately NOT rounded to öre, because neither half of the antal x á-pris
 * pair is necessarily money: Sexmästeriet's alcohol rows budget a cost as a
 * markup ratio times a base, 0.442143666 x 109538.80, and rounding that
 * quantity to two decimals moved one sheet by 345 kr. So this normalises the
 * decimal separator and checks the value is a real number, and otherwise leaves
 * the figure exactly as the file wrote it.
 */
function factorExpression(raw: string): string | null {
  const s = raw.trim().replace(/\s/g, "");
  if (s === "") return null;
  const normalised = s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s;
  return Number.isFinite(Number(normalised)) ? normalised : null;
}

/**
 * Parse the interchange CSV.
 *
 * Never throws: a row that cannot be read is reported in `problems` with its
 * line number and left out, so an import can show what it could not take rather
 * than failing whole. The caller decides whether any problem at all is a reason
 * to refuse the file.
 */
export function parseBudgetCsv(text: string): ParsedBudgetCsv {
  const problems: BudgetCsvProblem[] = [];
  const rawLines = text.split(/\r?\n/);

  const headerIndex = rawLines.findIndex((l) => l.trim() !== "");
  if (headerIndex === -1) {
    return { sheets: [], problems: [{ line: 1, message: "Filen är tom." }] };
  }

  const delimiter = sniffDelimiter(rawLines[headerIndex]);
  const header = splitCsvLine(rawLines[headerIndex], delimiter).map(norm);
  const col = new Map(header.map((h, i) => [h, i]));

  const missing = REQUIRED.filter((h) => !col.has(h));
  if (missing.length > 0) {
    return {
      sheets: [],
      problems: [
        {
          line: headerIndex + 1,
          message: `Rubriker saknas: ${missing.join(", ")}. Hittade: ${header.filter((h) => h).join(", ")}`,
        },
      ],
    };
  }
  for (const h of header) {
    if (h && !KNOWN.includes(h)) {
      problems.push({ line: headerIndex + 1, message: `Okänd kolumn "${h}", ignoreras.` });
    }
  }

  const at = (cols: string[], name: string): string => {
    const i = col.get(name);
    return i === undefined ? "" : (cols[i] ?? "").trim();
  };

  // Insertion order is the file's order, and the file's order is the budget's
  // order: a sheet reordered on import would not be the budget that was voted
  // through.
  const sheets = new Map<string, ParsedBudgetSheet>();
  const accounts = new Map<string, ParsedBudgetAccount>();

  for (let i = headerIndex + 1; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const lineNo = i + 1;
    if (!raw.trim()) continue;

    const cols = splitCsvLine(raw, delimiter);
    const ccCode = at(cols, "cost_center");
    const description = at(cols, "description");
    const accountRaw = at(cols, "account");

    if (!ccCode) {
      problems.push({ line: lineNo, message: "Rad utan kostnadsställe." });
      continue;
    }
    const accountCode = normalizeAccountCode(accountRaw);
    if (accountCode === null) {
      problems.push({ line: lineNo, message: `Ogiltigt kontonummer "${accountRaw}".` });
      continue;
    }
    if (!description) {
      problems.push({ line: lineNo, message: "Rad utan beskrivning." });
      continue;
    }

    const quantityRaw = at(cols, "quantity");
    const unitPriceRaw = at(cols, "unit_price");
    const amountRaw = at(cols, "amount");
    const hasPair = quantityRaw !== "" && unitPriceRaw !== "";
    const hasAmount = amountRaw !== "";

    let line: ParsedBudgetLine;
    if (hasPair) {
      const q = factorExpression(quantityRaw);
      const p = factorExpression(unitPriceRaw);
      if (q === null || p === null) {
        problems.push({
          line: lineNo,
          message: `Antal eller á-pris är inte ett tal ("${quantityRaw}" x "${unitPriceRaw}").`,
        });
        continue;
      }
      // The live equation, so the amount stays the product of the two, the
      // same thing import-budget.ts writes for an antal × á-pris row.
      line = { description, quantity: q, unitPrice: p, expression: `=${q}*${p}` };
    } else if (hasAmount) {
      const amount = amountExpression(amountRaw);
      if (amount === null) {
        problems.push({ line: lineNo, message: `Belopp är inte ett tal ("${amountRaw}").` });
        continue;
      }
      line = { description, quantity: null, unitPrice: null, expression: amount };
    } else if (quantityRaw !== "" || unitPriceRaw !== "") {
      // Half a pair and no amount: the row means nothing, and guessing which
      // half was meant to be the amount would put a wrong number in a budget.
      problems.push({
        line: lineNo,
        message: "Antal och á-pris måste anges tillsammans, annars belopp.",
      });
      continue;
    } else {
      problems.push({ line: lineNo, message: "Rad utan belopp." });
      continue;
    }

    let sheet = sheets.get(ccCode);
    if (!sheet) {
      sheet = {
        costCenterCode: ccCode,
        costCenterName: at(cols, "cc_name") || ccCode,
        accounts: [],
      };
      sheets.set(ccCode, sheet);
    }

    const accountKey = `${ccCode} ${accountCode}`;
    let account = accounts.get(accountKey);
    if (!account) {
      account = { code: accountCode, name: at(cols, "account_name") || accountCode, lines: [] };
      accounts.set(accountKey, account);
      sheet.accounts.push(account);
    }
    account.lines.push(line);
  }

  return { sheets: [...sheets.values()], problems };
}
