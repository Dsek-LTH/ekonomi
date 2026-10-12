import { describe, expect, it } from "vitest";
import { decodeCp437, parseSie } from "./sie";

describe("decodeCp437", () => {
  // The whole reason this exists: SIE files are "#FORMAT PC8", and read as
  // UTF-8 "Kostnadsställe" comes out as "Kostnadsstlle".
  it("turns the CP437 high half back into Swedish", () => {
    // ä = 0x84, ö = 0x94, å = 0x86, Ä = 0x8E, Ö = 0x99, Å = 0x8F
    const buf = Buffer.from([0x84, 0x94, 0x86, 0x8e, 0x99, 0x8f]);
    expect(decodeCp437(buf)).toBe("äöåÄÖÅ");
  });

  it("leaves ASCII alone", () => {
    expect(decodeCp437(Buffer.from("#KONTO 1930 Bank", "ascii"))).toBe("#KONTO 1930 Bank");
  });

  it("decodes a realistic mixed line", () => {
    const buf = Buffer.concat([
      Buffer.from('#KONTO 4010 "Kostnadsst', "ascii"),
      Buffer.from([0x84]), // ä
      Buffer.from('lle"', "ascii"),
    ]);
    expect(decodeCp437(buf)).toBe('#KONTO 4010 "Kostnadsställe"');
  });
});

describe("parseSie", () => {
  it("reads the chart of accounts", () => {
    const got = parseSie('#KONTO 1930 "Företagskonto"\n#KONTO 4010 "Inköp"');
    expect(got.accounts.get("1930")).toBe("Företagskonto");
    expect(got.accounts.get("4010")).toBe("Inköp");
  });

  it("falls back to the number when an account has no name", () => {
    expect(parseSie("#KONTO 1930").accounts.get("1930")).toBe("1930");
  });

  // Dimension 1 is the cost centre; anything else is some other dimension.
  it("reads cost centres from dimension 1 only", () => {
    const got = parseSie('#OBJEKT 1 "SEX02" "Sexmästeriet"\n#OBJEKT 6 "P1" "Projekt"');
    expect(got.costCenters.get("SEX02")).toBe("Sexmästeriet");
    expect(got.costCenters.has("P1")).toBe(false);
  });

  describe("vouchers", () => {
    const sie = [
      '#VER A 42 20260715 "Kvitto Ica" 20260716',
      "{",
      '#TRANS 4010 {1 "SEX02"} 250.00 20260715 "Fika"',
      "#TRANS 1930 {} -250.00",
      "}",
    ].join("\n");

    it("reads the voucher header", () => {
      const [v] = parseSie(sie).vouchers;
      expect(v.series).toBe("A");
      expect(v.number).toBe(42);
      // YYYYMMDD is turned into the ISO date the rest of the app speaks.
      expect(v.date).toBe("2026-07-15");
      expect(v.description).toBe("Kvitto Ica");
    });

    it("reads the postings, positive for debit and negative for credit", () => {
      const [v] = parseSie(sie).vouchers;
      expect(v.transactions).toEqual([
        { account: "4010", costCenterCode: "SEX02", amount: 250, text: "Fika" },
        { account: "1930", costCenterCode: undefined, amount: -250, text: undefined },
      ]);
    });

    it("closes a voucher at its closing brace, so the next one stands alone", () => {
      const got = parseSie([
        '#VER A 1 20260101 "Ett"',
        "{",
        "#TRANS 1930 {} 100.00",
        "}",
        '#VER A 2 20260202 "Två"',
        "{",
        "#TRANS 1930 {} 200.00",
        "}",
      ].join("\n"));
      expect(got.vouchers).toHaveLength(2);
      expect(got.vouchers[0].transactions).toHaveLength(1);
      expect(got.vouchers[1].transactions).toHaveLength(1);
      expect(got.vouchers[1].number).toBe(2);
    });

    it("picks dimension 1 out of a multi-dimension object list", () => {
      const got = parseSie([
        '#VER A 1 20260101 "Ett"',
        "{",
        '#TRANS 4010 {6 "P1" 1 "SEX02"} 100.00',
        "}",
      ].join("\n"));
      expect(got.vouchers[0].transactions[0].costCenterCode).toBe("SEX02");
    });

    // Fortnox emits the live posting as #TRANS; the correction registrations
    // beside it would double-count the voucher.
    it("ignores #RTRANS and #BTRANS", () => {
      const got = parseSie([
        '#VER A 1 20260101 "Ett"',
        "{",
        "#TRANS 4010 {} 100.00",
        "#RTRANS 4010 {} 999.00",
        "#BTRANS 4010 {} 888.00",
        "}",
      ].join("\n"));
      expect(got.vouchers[0].transactions).toHaveLength(1);
      expect(got.vouchers[0].transactions[0].amount).toBe(100);
    });

    it("drops a posting with no account or an unreadable amount", () => {
      const got = parseSie([
        '#VER A 1 20260101 "Ett"',
        "{",
        "#TRANS 4010 {} abc",
        "#TRANS 4010 {} 100.00",
        "}",
      ].join("\n"));
      expect(got.vouchers[0].transactions).toHaveLength(1);
    });

    it("ignores a posting that arrives outside any voucher", () => {
      expect(parseSie("#TRANS 4010 {} 100.00").vouchers).toEqual([]);
    });
  });

  describe("balances", () => {
    it("reads the account-level opening and closing balances", () => {
      const got = parseSie("#IB 0 1930 5000.00\n#UB 0 1930 7500.00");
      expect(got.openingBalances.get("1930|")).toBe(5000);
      expect(got.closingBalances.get("1930|")).toBe(7500);
    });

    // Only the year being synced is mirrored; -1 is the year before it.
    it("skips balances for any year but this one", () => {
      const got = parseSie("#IB -1 1930 100.00\n#UB -1 1930 200.00");
      expect(got.openingBalances.size).toBe(0);
      expect(got.closingBalances.size).toBe(0);
    });

    it("reads the per-cost-centre breakdown under its own key", () => {
      const got = parseSie('#OIB 0 1930 {1 "SEX02"} 1500.00\n#OUB 0 1930 {1 "SEX02"} 2000.00');
      expect(got.openingBalances.get("1930|SEX02")).toBe(1500);
      expect(got.closingBalances.get("1930|SEX02")).toBe(2000);
    });

    // The breakdown is optional detail, never the source of the total, so the
    // two live side by side under different keys.
    it("keeps the account total and its breakdown apart", () => {
      const got = parseSie([
        "#UB 0 1930 7500.00",
        '#OUB 0 1930 {1 "SEX02"} 2000.00',
      ].join("\n"));
      expect(got.closingBalances.get("1930|")).toBe(7500);
      expect(got.closingBalances.get("1930|SEX02")).toBe(2000);
    });

    it("drops a per-object balance carrying no cost centre", () => {
      const got = parseSie("#OUB 0 1930 {} 2000.00");
      expect(got.closingBalances.size).toBe(0);
    });
  });

  it("ignores blank lines and anything it doesn't know", () => {
    const got = parseSie([
      "#FLAGGA 0",
      "",
      '#FNAMN "D-sektionen"',
      "   ",
      '#KONTO 1930 "Bank"',
    ].join("\n"));
    expect(got.accounts.size).toBe(1);
    expect(got.vouchers).toEqual([]);
  });

  it("parses an empty file into empty everything", () => {
    const got = parseSie("");
    expect(got.accounts.size).toBe(0);
    expect(got.costCenters.size).toBe(0);
    expect(got.vouchers).toEqual([]);
    expect(got.openingBalances.size).toBe(0);
    expect(got.closingBalances.size).toBe(0);
  });

  it("reads CRLF line endings, which is what the files actually carry", () => {
    const got = parseSie('#KONTO 1930 "Bank"\r\n#KONTO 4010 "Inköp"\r\n');
    expect(got.accounts.size).toBe(2);
  });
});
