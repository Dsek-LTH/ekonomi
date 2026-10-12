import { describe, expect, it } from "vitest";
import { normalizeAccountCode, parseBudgetCsv } from "@/lib/domain/budget-csv";

const HEADER =
  "cost_center,cc_name,account,account_name,description,quantity,unit_price,amount";

const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("normalizeAccountCode", () => {
  it("strips the trailing .0 a spreadsheet leaves on a number", () => {
    expect(normalizeAccountCode("3015.0")).toBe("3015");
    expect(normalizeAccountCode("3015")).toBe("3015");
  });

  it("rejects a code that is not a bare number", () => {
    // A range header: the Utfall report resolves accounts with Number(code),
    // so a range would be dropped from the comparison without a word.
    expect(normalizeAccountCode("3011-3014")).toBeNull();
    expect(normalizeAccountCode("")).toBeNull();
  });
});

describe("parseBudgetCsv", () => {
  it("builds sheets, accounts and lines from a flat file", () => {
    const { sheets, problems } = parseBudgetCsv(
      file(
        "SEX02,Sittningar,3015,Biljettförsäljning,T. sittningar,,,250000",
        "SEX02,Sittningar,3015,Biljettförsäljning,Inbakad märkeskostnad,,,25000",
        "SEX02,Sittningar,4000,Inköp av varor,Märken,,,20000",
        "NOLL01,Nollning,3015,Biljettförsäljning,Biljetter,,,5000",
      ),
    );
    expect(problems).toEqual([]);
    expect(sheets).toHaveLength(2);
    expect(sheets[0].costCenterCode).toBe("SEX02");
    expect(sheets[0].costCenterName).toBe("Sittningar");
    expect(sheets[0].accounts).toHaveLength(2);
    expect(sheets[0].accounts[0].lines.map((l) => l.description)).toEqual([
      "T. sittningar",
      "Inbakad märkeskostnad",
    ]);
    expect(sheets[1].accounts[0].lines[0].expression).toBe("5000");
  });

  it("keeps the antal x á-pris pair as a live equation", () => {
    const { sheets } = parseBudgetCsv(
      file("SEX02,Sittningar,3011,Alkoholförsäljning,Öl,1.44,48431.89,"),
    );
    expect(sheets[0].accounts[0].lines[0]).toEqual({
      description: "Öl",
      quantity: "1.44",
      unitPrice: "48431.89",
      expression: "=1.44*48431.89",
    });
  });

  it("does not round a factor to öre", () => {
    // Sexmästeriet budgets an alcohol cost as a markup ratio times a base.
    // Rounding the ratio to two decimals moves the sheet by hundreds of kronor,
    // so a factor keeps every digit the file gave it, unlike an amount, which
    // is money and is held to öre.
    const { sheets } = parseBudgetCsv(
      file("SEX02,Sittningar,4011,Alkoholkostnader,Öl,0.442143666,109538.80,"),
    );
    const line = sheets[0].accounts[0].lines[0];
    expect(line.quantity).toBe("0.442143666");
    expect(line.expression).toBe("=0.442143666*109538.80");
  });

  it("holds an amount to öre, since that is what it is compared in", () => {
    const { sheets } = parseBudgetCsv(
      file("SEX02,Sittningar,3015,Biljetter,Biljetter,,,560705.0151"),
    );
    expect(sheets[0].accounts[0].lines[0].expression).toBe("560705.02");
  });

  it("reads a semicolon file with comma decimals", () => {
    const { sheets, problems } = parseBudgetCsv(
      [
        "cost_center;cc_name;account;account_name;description;quantity;unit_price;amount",
        'SEX02;Sittningar;3015;Biljettförsäljning;"Mat, dryck";;;1 234,50',
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(sheets[0].accounts[0].lines[0].description).toBe("Mat, dryck");
    expect(sheets[0].accounts[0].lines[0].expression).toBe("1234.5");
  });

  it("does not care what order the columns are in", () => {
    const { sheets, problems } = parseBudgetCsv(
      ["description,amount,account,cost_center", "Märken,20000,4000,SEX02"].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(sheets[0].accounts[0].lines[0].expression).toBe("20000");
    // No cc_name or account_name column: the codes stand in for the names.
    expect(sheets[0].costCenterName).toBe("SEX02");
    expect(sheets[0].accounts[0].name).toBe("4000");
  });

  it("reports the missing headers and reads nothing", () => {
    const { sheets, problems } = parseBudgetCsv("konto,belopp\n3015,250000");
    expect(sheets).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("cost_center");
  });

  it("skips a bad row, keeps the rest, and says which line", () => {
    const { sheets, problems } = parseBudgetCsv(
      file(
        "SEX02,Sittningar,3011-3014,Alkohol,Öl,,,1000",
        "SEX02,Sittningar,3015,Biljetter,Biljetter,,,250000",
        "SEX02,Sittningar,3015,Biljetter,Utan belopp,,,",
      ),
    );
    expect(sheets[0].accounts).toHaveLength(1);
    expect(sheets[0].accounts[0].lines).toHaveLength(1);
    expect(problems.map((p) => p.line)).toEqual([2, 4]);
    expect(problems[0].message).toContain("3011-3014");
  });

  it("refuses half an antal x á-pris pair rather than guessing", () => {
    const { sheets, problems } = parseBudgetCsv(
      file("SEX02,Sittningar,3011,Alkohol,Öl,1.44,,"),
    );
    expect(sheets).toEqual([]);
    expect(problems[0].message).toContain("tillsammans");
  });

  it("notes an unknown column without dropping the row", () => {
    const { sheets, problems } = parseBudgetCsv(
      [
        "cost_center,account,description,amount,kommentar",
        "SEX02,3015,Biljetter,250000,vet ej",
      ].join("\n"),
    );
    expect(sheets[0].accounts[0].lines).toHaveLength(1);
    expect(problems[0].message).toContain("kommentar");
  });
});
