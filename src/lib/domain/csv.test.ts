import { describe, expect, it } from "vitest";
import { amountToOre, decodeCsvBytes, sniffDelimiter, splitCsvLine } from "@/lib/domain/csv";

describe("splitCsvLine", () => {
  it("splits on the given delimiter", () => {
    expect(splitCsvLine("a;b;c", ";")).toEqual(["a", "b", "c"]);
    expect(splitCsvLine("a\tb\tc", "\t")).toEqual(["a", "b", "c"]);
  });

  it("keeps the delimiter when it is inside a quoted field", () => {
    expect(splitCsvLine('a;"b;c";d', ";")).toEqual(["a", "b;c", "d"]);
  });

  it("reads a doubled quote as a literal quote", () => {
    expect(splitCsvLine('"say ""hi""",b')).toEqual(['say "hi"', "b"]);
  });

  it("keeps empty fields, including trailing ones", () => {
    expect(splitCsvLine("a,,c,")).toEqual(["a", "", "c", ""]);
  });
});

describe("sniffDelimiter", () => {
  it("finds each of the three candidates", () => {
    expect(sniffDelimiter("a,b,c")).toBe(",");
    expect(sniffDelimiter("a;b;c")).toBe(";");
    expect(sniffDelimiter("a\tb\tc")).toBe("\t");
  });

  it("is not fooled by a comma inside a quoted field", () => {
    // Swedish Excel: semicolon-delimited, and a description holding a comma.
    expect(sniffDelimiter('konto;namn;"mat, dryck";belopp')).toBe(";");
  });

  it("falls back to comma for a single-column file", () => {
    expect(sniffDelimiter("beskrivning")).toBe(",");
  });
});

describe("amountToOre", () => {
  it("accepts both decimal conventions", () => {
    expect(amountToOre("5901.00")).toBe(590100);
    expect(amountToOre("5901,00")).toBe(590100);
  });

  it("ignores spacing used as a thousands separator", () => {
    expect(amountToOre("-1 234,50")).toBe(-123450);
  });

  it("rounds to whole öre", () => {
    expect(amountToOre("48431.8866")).toBe(4843189);
  });

  it("is null for something that is not a number", () => {
    expect(amountToOre("n/a")).toBeNull();
  });
});

describe("decodeCsvBytes", () => {
  it("strips a UTF-8 BOM", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Öl", "utf8")]);
    expect(decodeCsvBytes(buf)).toBe("Öl");
  });

  it("reads UTF-8 without a BOM", () => {
    expect(decodeCsvBytes(Buffer.from("Sexmästeriet", "utf8"))).toBe("Sexmästeriet");
  });

  it("falls back to Windows-1252 when the bytes are not valid UTF-8", () => {
    // What Excel writes on a Swedish Windows machine: å ä ö as single bytes.
    expect(decodeCsvBytes(Buffer.from("Sexm\xe4steriet", "latin1"))).toBe("Sexmästeriet");
  });
});
