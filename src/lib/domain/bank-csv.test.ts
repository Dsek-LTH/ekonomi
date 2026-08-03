import { describe, expect, it } from "vitest";
import { parseBankCsv } from "./bank-csv";

// Every sample below is invented: the clearing and account numbers are zeroes
// and the purchases are made up. A real bank export must never be checked in
// (see .gitignore) — and nothing here needs one.
const HEADER =
  "Radnr,Clnr,Kontonr,Produkt,Valuta,Bokfdag,Transdag,Valutadag,Referens,Text,Belopp";
const COMMENT = "* Transaktionsrapport Period 2026-01-01 - 2026-03-31 Skapad 2026-03-31 20:06 CEST";

// One data row, with only the parts the parser reads worth varying.
const row = (opts: { n?: number; date?: string; referens: string; amount: string }) =>
  [
    opts.n ?? 1,
    "0000",
    "0000000000",
    '"Företagskonto"',
    "SEK",
    opts.date ?? "2026-03-01",
    opts.date ?? "2026-03-01",
    opts.date ?? "2026-03-01",
    `"${opts.referens}"`,
    '"Kortköp/uttag"',
    opts.amount,
  ].join(",");

const file = (...rows: string[]) => [COMMENT, HEADER, ...rows].join("\r\n");

describe("parseBankCsv", () => {
  it("reads a purchase, skipping the comment and header lines", () => {
    const result = parseBankCsv(file(row({ referens: "KAFFEBAREN LUND", amount: "-149.50" })));

    expect(result.transactions).toHaveLength(1);
    expect(result.skippedRows).toBe(0);
    expect(result.transactions[0]).toMatchObject({
      bookedDate: "2026-03-01",
      description: "KAFFEBAREN LUND",
      amount: -14950, // öre, negative because the money left the account
    });
  });

  it("pulls the card number off the end of the reference", () => {
    const result = parseBankCsv(file(row({ referens: "KAFFEBAREN LUND K1234", amount: "-149.50" })));

    expect(result.transactions[0].description).toBe("KAFFEBAREN LUND");
    expect(result.transactions[0].cardLast4).toBe("1234");
    expect(result.cardLast4s).toEqual(["1234"]);
  });

  it("leaves a reference without a card token alone", () => {
    const result = parseBankCsv(file(row({ referens: "SWISH INBETALNING", amount: "500.00" })));

    expect(result.transactions[0].description).toBe("SWISH INBETALNING");
    expect(result.transactions[0].cardLast4).toBeUndefined();
    expect(result.cardLast4s).toEqual([]);
  });

  it("keeps an incoming amount positive", () => {
    // A refund arrives as money in, and only a return may settle against it.
    const result = parseBankCsv(file(row({ referens: "ÅTERBETALNING", amount: "149.50" })));
    expect(result.transactions[0].amount).toBe(14950);
  });

  it("reads both decimal separators and spaced thousands", () => {
    const result = parseBankCsv(
      file(
        row({ n: 1, referens: "A", amount: "-1234.50" }),
        row({ n: 2, referens: "B", amount: '"-1 234,50"' }),
      ),
    );
    expect(result.transactions.map((t) => t.amount)).toEqual([-123450, -123450]);
  });

  it("keeps a comma inside a quoted field out of the column split", () => {
    const result = parseBankCsv(
      file(row({ referens: "BLOMSTER, LUND AB K1234", amount: "-320.00" })),
    );
    expect(result.transactions[0].description).toBe("BLOMSTER, LUND AB");
    expect(result.transactions[0].amount).toBe(-32000);
  });

  it("counts rows it cannot read instead of dropping them silently", () => {
    const result = parseBankCsv(
      file(
        row({ referens: "GILTIG", amount: "-100.00" }),
        "2,0000,0000000000", // truncated line
        row({ n: 3, date: "not-a-date", referens: "TRASIG", amount: "-100.00" }),
        row({ n: 4, referens: "TRASIGT BELOPP", amount: "abc" }),
      ),
    );
    expect(result.transactions).toHaveLength(1);
    expect(result.skippedRows).toBe(3);
  });

  it("collects each distinct card once", () => {
    const result = parseBankCsv(
      file(
        row({ n: 1, referens: "A K1234", amount: "-10.00" }),
        row({ n: 2, referens: "B K5678", amount: "-20.00" }),
        row({ n: 3, referens: "C K1234", amount: "-30.00" }),
      ),
    );
    expect(result.cardLast4s.sort()).toEqual(["1234", "5678"]);
  });

  it("gives two genuinely identical purchases distinct hashes", () => {
    // Two coffees on the same card, same day, same price is an ordinary
    // Tuesday — they must not collapse into one transaction on import.
    const identical = row({ referens: "KAFFEBAREN LUND K1234", amount: "-49.00" });
    const result = parseBankCsv(file(identical, identical));

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].importHash).not.toBe(result.transactions[1].importHash);
  });

  it("produces the same hashes when the same file is imported twice", () => {
    // This is what makes a re-import a no-op rather than a duplicate ledger.
    const text = file(
      row({ n: 1, referens: "KAFFEBAREN LUND K1234", amount: "-49.00" }),
      row({ n: 2, referens: "KAFFEBAREN LUND K1234", amount: "-49.00" }),
      row({ n: 3, referens: "BOKHANDELN", amount: "-249.00" }),
    );
    const first = parseBankCsv(text).transactions.map((t) => t.importHash);
    const second = parseBankCsv(text).transactions.map((t) => t.importHash);
    expect(second).toEqual(first);
  });

  it("returns nothing for a file with no data rows", () => {
    const result = parseBankCsv([COMMENT, HEADER].join("\r\n"));
    expect(result.transactions).toEqual([]);
    expect(result.skippedRows).toBe(0);
  });
});
