// Parser for the budget interchange CSV: one row per budget line with its sheet and account keys
// repeated, so the tree is rebuilt here.
//   cost_center,cc_name,account,account_name,description,quantity,unit_price,amount
//   SEX02,Sittningar,3015,Biljettförsäljning,T. sittningar,,,250000
// Amounts are kronor. Either `amount` or the `quantity`/`unit_price` pair is given, never both
// (the rule BudgetLineItem states in the schema).
import { amountToOre, sniffDelimiter, splitCsvLine } from "@/lib/domain/csv";

interface ParsedBudgetLine {
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  expression: string;
}

interface ParsedBudgetAccount {
  code: string;
  name: string;
  lines: ParsedBudgetLine[];
}

interface ParsedBudgetSheet {
  costCenterCode: string;
  costCenterName: string;
  accounts: ParsedBudgetAccount[];
}

interface BudgetCsvProblem {
  line: number;
  message: string;
}

interface ParsedBudgetCsv {
  sheets: ParsedBudgetSheet[];
  problems: BudgetCsvProblem[];
}

// The columns, by header name. Order in the file is free.
const REQUIRED = ["cost_center", "account", "description"] as const;
const OPTIONAL = ["cc_name", "account_name", "quantity", "unit_price", "amount"] as const;
const KNOWN: readonly string[] = [...REQUIRED, ...OPTIONAL];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");

/** An account code as the budget stores it. Spreadsheets give "3015.0", and the Utfall report resolves accounts with Number(code), so a non-bare number would be dropped silently: strip the ".0" here. */
export function normalizeAccountCode(raw: string): string | null {
  const s = raw.trim().replace(/\.0+$/, "");
  return /^\d{3,6}$/.test(s) ? s : null;
}

/** An amount in kronor as an expression string. Goes through öre so "1 234,50" and "1234.50" agree; the budget is compared against the ledger in öre (lib/ledger/comparison.ts). */
function amountExpression(raw: string): string | null {
  const ore = amountToOre(raw);
  return ore === null ? null : String(ore / 100);
}

/** A plain factor as an expression string. NOT rounded to öre: antal and á-pris need not be money (a markup ratio 0.442143666 x 109538.80 moved one sheet by 345 kr when rounded). Only the decimal separator is normalised. */
function factorExpression(raw: string): string | null {
  const s = raw.trim().replace(/\s/g, "");
  if (s === "") return null;
  const normalised = s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s;
  return Number.isFinite(Number(normalised)) ? normalised : null;
}

/** Parse the interchange CSV. Never throws: an unreadable row is reported in `problems` with its line number and left out. */
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

  // Insertion order is the file's order, which is the budget's voted order.
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
      // The live equation, so the amount stays the product (as import-budget.ts writes it).
      line = { description, quantity: q, unitPrice: p, expression: `=${q}*${p}` };
    } else if (hasAmount) {
      const amount = amountExpression(amountRaw);
      if (amount === null) {
        problems.push({
          line: lineNo,
          message: `Belopp är inte ett tal ("${amountRaw}").`,
        });
        continue;
      }
      line = { description, quantity: null, unitPrice: null, expression: amount };
    } else if (quantityRaw !== "" || unitPriceRaw !== "") {
      // Half a pair and no amount: guessing which half is the amount would put a wrong number in a budget.
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
      account = {
        code: accountCode,
        name: at(cols, "account_name") || accountCode,
        lines: [],
      };
      accounts.set(accountKey, account);
      sheet.accounts.push(account);
    }
    account.lines.push(line);
  }

  return { sheets: [...sheets.values()], problems };
}
