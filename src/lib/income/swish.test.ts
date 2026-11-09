import { describe, expect, it } from "vitest";

import { parseSwishAmount, parseSwishPayments, SwishParseError } from "./swish";

const HEADER =
  "Radnr,Clnr,Kontonr,Bokfdag,Transdag,Valutadag,Mottagarnr,Mottagarnamn,Avsändarnr,Avsändarnamn,Meddelande,Tid,Belopp,Orderreferens";

const record = (date: string, message: string, amount: string) =>
  `1,83139,0700000000,${date},${date},${date},123,D-SEKTIONEN INOM TLTH,+46700000000,Test Testsson,${message},12:00,${amount},`;

const csv = (...rows: string[]) =>
  ["* Swish-rapport Avser 2025-01-01 - 2025-01-31", HEADER, ...rows].join("\r\n") + "\r\n";

/** Encoded as the bank does: ISO-8859-1, one byte per character. */
const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("parseSwishPayments", () => {
  it("keeps messages as written and filters to the range", () => {
    const got = parseSwishPayments(
      latin1(
        csv(
          record("2025-01-10", "CA - Kaffe", "25.00"),
          record("2025-01-10", "no prefix here", "10.00"),
          record("2025-02-10", "CA - Kaffe", "25.00"),
        ),
      ),
      "2025-01-01",
      "2025-01-31",
    );
    expect(got).toEqual([
      { date: "2025-01-10", message: "CA - Kaffe", amount: 2500 },
      { date: "2025-01-10", message: "no prefix here", amount: 1000 },
    ]);
  });

  it("is inclusive at both ends, and a single day is a range", () => {
    const file = latin1(
      csv(
        record("2025-01-01", "c-A", "1.00"),
        record("2025-01-31", "c-B", "2.00"),
        record("2025-02-01", "c-C", "3.00"),
      ),
    );
    expect(parseSwishPayments(file, "2025-01-01", "2025-01-31").map((p) => p.message)).toEqual([
      "c-A",
      "c-B",
    ]);
    expect(parseSwishPayments(file, "2025-01-31", "2025-01-31")).toHaveLength(1);
  });

  it("reads the bank's ISO-8859-1, å ä ö intact", () => {
    const [p] = parseSwishPayments(
      latin1(csv(record("2025-01-10", "c-Dyr läsk åäö", "14.00"))),
      "2025-01-01",
      "2025-01-31",
    );
    expect(p.message).toBe("c-Dyr läsk åäö");
  });

  it("reads a file that is UTF-8 as UTF-8", () => {
    const [p] = parseSwishPayments(
      new TextEncoder().encode(csv(record("2025-01-10", "c-Räksmörgås", "14.00"))),
      "2025-01-01",
      "2025-01-31",
    );
    expect(p.message).toBe("c-Räksmörgås");
  });

  it("keeps refunds, negative, and skips zero amounts and unreadable rows", () => {
    const got = parseSwishPayments(
      latin1(
        csv(
          record("2025-01-10", "c-Retur", "-50.25"),
          record("2025-01-10", "c-Noll", "0.00"),
          record("2025-01-10", "c-Trasig", "abc"),
          record("not a day", "c-Datum", "10.00"),
          record("2025-02-30", "c-Omöjlig", "10.00"),
        ),
      ),
      "2025-01-01",
      "2025-12-31",
    );
    expect(got).toEqual([{ date: "2025-01-10", message: "c-Retur", amount: -5025 }]);
  });

  it("reads quoted fields, commas inside them, and stray quotes leniently", () => {
    const row = `1,2,3,2025-01-10,2025-01-10,6,7,8,9,10,"c-Bulle, stor",12:00,30.00,`;
    const lazy = `1,2,3,2025-01-10,2025-01-10,6,7,8,9,10,c-"Kanel"bulle,12:00,20.00,`;
    const got = parseSwishPayments(latin1(csv(row, lazy)), "2025-01-01", "2025-01-31");
    expect(got.map((p) => p.message)).toEqual(["c-Bulle, stor", 'c-"Kanel"bulle']);
  });

  it("refuses a row whose field count differs from the header, naming the line", () => {
    const short = "1,2,3,2025-01-10,2025-01-10,6,7,8,9,10,c-Kaffe,12:00,25.00";
    expect(() => parseSwishPayments(latin1(csv(short)), "2025-01-01", "2025-01-31")).toThrow(
      SwishParseError,
    );
    expect(() => parseSwishPayments(latin1(csv(short)), "2025-01-01", "2025-01-31")).toThrow(
      /line 3/,
    );
  });

  it("returns nothing for a file with only a header", () => {
    expect(parseSwishPayments(latin1(csv()), "2025-01-01", "2025-01-31")).toEqual([]);
  });
});

describe("parseSwishAmount", () => {
  it.each([
    ["25.00", 2500],
    ["0.05", 5],
    ["1234.99", 123499],
    ["-50.00", -5000],
    ["-50.25", -5025],
    // Read with the sign on the kronor, this came back as +50 öre.
    ["-0.50", -50],
  ])("reads %s as %i öre", (input, ore) => {
    expect(parseSwishAmount(input)).toBe(ore);
  });

  it.each(["--1.00", "25", "25.5", "abc.de", "1,00", ""])("refuses %j", (input) => {
    expect(parseSwishAmount(input)).toBeNull();
  });
});
