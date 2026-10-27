import { describe, expect, it } from "vitest";
import {
  autoAssign,
  cleanSubject,
  parseAddress,
  rejectReason,
  splitForward,
} from "./inbound-mail";

describe("parseAddress", () => {
  it.each([
    ['"Anna Berg" <Anna.Berg@dsek.se>', { address: "anna.berg@dsek.se", name: "Anna Berg" }],
    ["Anna Berg <anna@dsek.se>", { address: "anna@dsek.se", name: "Anna Berg" }],
    ["<anna@dsek.se>", { address: "anna@dsek.se", name: null }],
    ["anna@dsek.se", { address: "anna@dsek.se", name: null }],
  ])("reads %s", (header, expected) => {
    expect(parseAddress(header)).toEqual(expected);
  });

  it("refuses what is not an address", () => {
    expect(parseAddress("Anna Berg")).toBeNull();
    expect(parseAddress("")).toBeNull();
  });
});

describe("rejectReason", () => {
  const anna = { address: "anna@dsek.se" };
  const gmail = (results: string) => `mx.google.com; ${results}`;

  it("takes a dsek.se sender DMARC passed", () => {
    const h = [gmail("dkim=pass header.i=@dsek.se; spf=pass; dmarc=pass (p=NONE) header.from=dsek.se")];
    expect(rejectReason(anna, h, "dsek.se")).toBeNull();
  });

  it("takes a verified DKIM signature from the domain without DMARC", () => {
    expect(rejectReason(anna, [gmail("dkim=pass header.i=@dsek.se header.s=google")], "dsek.se")).toBeNull();
  });

  it("refuses another domain however well it authenticates", () => {
    const h = [gmail("dkim=pass header.i=@lundsslap.se; dmarc=pass header.from=lundsslap.se")];
    expect(rejectReason({ address: "faktura@lundsslap.se" }, h, "dsek.se")).toBe("foreignDomain");
  });

  it("refuses a subdomain lookalike", () => {
    expect(rejectReason({ address: "anna@evil-dsek.se" }, [], "dsek.se")).toBe("foreignDomain");
  });

  it("refuses a dsek.se From that Gmail could not verify", () => {
    const h = [gmail("dkim=fail header.i=@dsek.se; dmarc=fail header.from=dsek.se")];
    expect(rejectReason(anna, h, "dsek.se")).toBe("notAuthenticated");
    expect(rejectReason(anna, [], "dsek.se")).toBe("notAuthenticated");
  });

  it("reads only Gmail's own header, not one the sender wrote further down", () => {
    const forged = "mx.google.com; dkim=pass header.i=@dsek.se";
    const h = [gmail("dkim=none; dmarc=fail header.from=dsek.se"), forged];
    expect(rejectReason(anna, h, "dsek.se")).toBe("notAuthenticated");
  });

  it("does not count a DKIM pass for some other domain", () => {
    const h = [gmail("dkim=pass header.i=@mailchimp.com")];
    expect(rejectReason(anna, h, "dsek.se")).toBe("notAuthenticated");
  });

  it("refuses a mail with no sender at all", () => {
    expect(rejectReason(null, [], "dsek.se")).toBe("noSender");
  });
});

describe("splitForward", () => {
  it("splits a Gmail forward and reads the supplier", () => {
    const text = [
      "Till SEX01, släpet till nollningen.",
      "",
      "---------- Forwarded message ---------",
      "From: Lunds Släp AB <faktura@lundsslap.se>",
      "Date: Mon, 26 Oct 2026",
      "Subject: Faktura 20417",
    ].join("\n");
    expect(splitForward(text)).toEqual({
      note: "Till SEX01, släpet till nollningen.",
      originalFrom: "faktura@lundsslap.se",
    });
  });

  it("understands a Swedish Gmail", () => {
    const text = "Hej!\n\n---------- Vidarebefordrat meddelande ---------\nFrån: faktura@lundsslap.se\n";
    expect(splitForward(text)).toEqual({ note: "Hej!", originalFrom: "faktura@lundsslap.se" });
  });

  it("understands Outlook's mailto form", () => {
    const text = "Caféet\n\nFrån: Grossisten [mailto:order@grossisten.se]\nSkickat: måndag\n";
    expect(splitForward(text)).toEqual({ note: "Caféet", originalFrom: "order@grossisten.se" });
  });

  it("treats a mail that forwards nothing as all note", () => {
    expect(splitForward("Faktura för hyra av lokal")).toEqual({
      note: "Faktura för hyra av lokal",
      originalFrom: null,
    });
  });

  it("has no note when the forwarder wrote nothing", () => {
    expect(splitForward("---------- Forwarded message ---------\nFrom: a@b.se")).toEqual({
      note: null,
      originalFrom: "a@b.se",
    });
  });
});

describe("cleanSubject", () => {
  it.each([
    ["Fwd: Faktura 20417", "Faktura 20417"],
    ["VB: Fw: Faktura", "Faktura"],
    ["Faktura", "Faktura"],
    ["Fwd:", null],
  ])("%s", (subject, expected) => {
    expect(cleanSubject(subject)).toBe(expected);
  });
});

describe("autoAssign", () => {
  const units = [
    { id: "sex", name: "Sexmästeriet" },
    { id: "cafe", name: "Caféutskottet" },
    { id: "cpu", name: "CPU" },
  ];
  const costCenters = [
    { code: "SEX01", resultUnitId: "sex" },
    { code: "SEX02", resultUnitId: "sex" },
    { code: "CAFE01", resultUnitId: "cafe" },
    { code: "STY01", resultUnitId: null },
  ];
  const run = (text: string, forwarderUnitIds: string[] = []) =>
    autoAssign({ text, units, costCenters, forwarderUnitIds });

  it("goes by a cost centre code", () => {
    expect(run("Kontera på sex01 tack")).toEqual({ resultUnitId: "sex", rule: "costCenter", match: "SEX01" });
  });

  it("goes by several codes of one unit", () => {
    expect(run("SEX01 och SEX02")?.resultUnitId).toBe("sex");
  });

  it("leaves codes from two units for a person", () => {
    expect(run("Dela SEX01 och CAFE01", ["sex"])).toBeNull();
  });

  it("ignores something code-shaped that is not a cost centre", () => {
    expect(run("Faktura NR2041 från leverantören")).toBeNull();
  });

  it("goes by a unit named in so many words", () => {
    expect(run("Den här är till Sexmästeriet")).toEqual({
      resultUnitId: "sex",
      rule: "unitName",
      match: "Sexmästeriet",
    });
  });

  it("does not match a unit name inside another word", () => {
    expect(run("CPUkylare till datorn")).toBeNull();
  });

  it("leaves two named units for a person", () => {
    expect(run("Sexmästeriet och Caféutskottet delar", ["sex"])).toBeNull();
  });

  it("falls back to the forwarder's only unit", () => {
    expect(run("", ["cafe"])).toEqual({ resultUnitId: "cafe", rule: "forwarder", match: "Caféutskottet" });
  });

  it("does not guess for a forwarder with two units", () => {
    expect(run("", ["cafe", "sex"])).toBeNull();
  });
});
