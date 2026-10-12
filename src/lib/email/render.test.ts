import { describe, expect, it } from "vitest";
import { LOGO_CID, renderHtml, renderText, type Email } from "./render";

const base: Email = {
  subject: "Att attestera: DEK26-0043 – Kolsyra",
  tone: "action",
  eyebrow: "Att attestera",
  heading: "Ludwig har skickat in ett utlägg",
  intro: "Det väntar på din attest.",
  blocks: [
    {
      kind: "expense",
      reference: "DEK26-0043",
      title: "Kolsyra",
      amount: "450,00 kr",
      facts: [{ label: "Betalning", value: "Eget utlägg", tag: "REIMBURSEMENT" }],
    },
  ],
  action: { label: "Öppna och attestera", url: "https://example.test/expenses/e1" },
  orOpen: "Eller öppna länken: https://example.test/expenses/e1",
  footer: {
    reason: "Du får det här mejlet eftersom du kan attestera utlägget.",
    settings: { label: "Välj vilka mejl du får under Profil.", url: "https://example.test/profile" },
    org: "D-sektionen inom TLTH",
  },
  brand: { name: "Ekonomi", org: "D-sektionen inom TLTH" },
};

describe("renderHtml", () => {
  it("escapes everything a member typed", async () => {
    // A title and a comment are the submitter's and attester's own words, and
    // a mail client renders whatever HTML arrives.
    const html = await renderHtml({
      ...base,
      blocks: [
        { kind: "comment", author: "Maja", when: "idag", text: '<img src=x onerror="alert(1)">' },
      ],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("draws the logo from the attachment, not from the web", async () => {
    expect(await renderHtml(base)).toContain(`src="cid:${LOGO_CID}"`);
  });

  it("links the button to the utlägg, with Outlook's padding fix", async () => {
    const html = await renderHtml(base);
    expect(html).toContain('href="https://example.test/expenses/e1"');
    expect(html).toContain("mso-padding-alt");
  });
});

describe("renderText", () => {
  it("says everything the HTML does, links spelled out", () => {
    const text = renderText(base);
    expect(text).toContain("DEK26-0043 – Kolsyra");
    expect(text).toContain("Betalning: Eget utlägg");
    expect(text).toContain("Öppna och attestera: https://example.test/expenses/e1");
    expect(text).toContain("Välj vilka mejl du får under Profil. https://example.test/profile");
  });

  it("marks a refund in words, where the HTML has a colour", () => {
    const text = renderText({
      ...base,
      blocks: [
        {
          kind: "transactions",
          head: { date: "Datum", description: "Beskrivning", amount: "Belopp" },
          refundLabel: "Återbetalning",
          rows: [{ date: "2026-10-06", description: "Q*nelly.com", amount: "+1 144,00 kr", refund: true }],
        },
      ],
    });
    expect(text).toContain("2026-10-06 – Q*nelly.com – +1 144,00 kr (Återbetalning)");
  });
});
