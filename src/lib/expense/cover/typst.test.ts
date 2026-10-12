import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { renderCover } from "./typst";
import type { ExpenseCoverData } from "./types";

// These run everywhere, with no skip guard, because the typesetter is a
// dependency rather than something the machine has to have, which is the whole
// point of it being the napi build. intakt's LaTeX tests still skip themselves
// when pdflatex is absent (intakt/report/latex_test.go); this does not have to.
//
// What the page *says* is tested in ../document.test.ts without going near a
// renderer. These only ask whether the template still compiles into pages.

const data: ExpenseCoverData = {
  reference: "DEK26-0042",
  title: "FREETRAILER: Hyrning av släp",
  purchaseDate: "2026-03-19",
  dateLabel: "Kvittodatum",
  paymentType: "Privat utlägg",
  created: "2026-08-14",
  submitter: { name: 'Emil "jajebums" Helander', studentId: "em8241he-s" },
  // Not a milersättning: its underlag is a real receipt and follows on the
  // next page, so the page draws no journey section.
  journey: null,
  // In time, so there is no dispens to state. The one that is takes its own
  // test below.
  waiver: null,
  total: "1 069,00 kr",
  allocations: [
    {
      costCenter: "SEKT05 – Sexmästeriet",
      amount: "69,00 kr",
      comment: null,
      approvedBy: 'Ludwig "Alphan" Gehlsdorf',
      approvedAt: "2026-04-02",
    },
    {
      costCenter: "SEKT12 – Näringslivsutskottet",
      amount: "1 000,00 kr",
      comment: "Halva kostnaden delas med NLU enligt överenskommelse i styrelsen",
      approvedBy: null,
      approvedAt: null,
    },
  ],
};

describe("renderCover", () => {
  it("renders a one-page cover", async () => {
    const bytes = await renderCover(data);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  });

  it("survives everything the data allows to be missing", async () => {
    // A draft previewed before it has a reference, from a user with no StiL-ID,
    // with nothing attested yet, every optional field absent at once, which is
    // the shape most likely to blow up a template that assumed otherwise.
    const bytes = await renderCover({
      ...data,
      reference: "–",
      purchaseDate: null,
      submitter: { name: "Anon", studentId: null },
      allocations: [
        {
          costCenter: "SEKT05 – Sexmästeriet",
          amount: "69,00 kr",
          comment: null,
          approvedBy: null,
          approvedAt: null,
        },
      ],
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("states a dispens without pushing the page over", async () => {
    // A late utlägg taken anyway, with a reason of the length somebody actually
    // writes. The block sits above the attesteringar and must not cost the
    // page its second half.
    const bytes = await renderCover({
      ...data,
      waiver: {
        by: "Nora Lindqvist",
        at: "2026-06-03",
        reason:
          "Kvittot kom bort i flytten till det nya förrådet och har eftersökts sedan i maj. " +
          "Utlägget är styrkt mot leverantörens kopia och tas emot trots fristen.",
        lateness: "76 dagar efter köpet",
      },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("renders a milersättning's journey on the same one page", async () => {
    // The section that used to be a second document. It is set above the attest
    // table, so the page it is on is still the page it has always been.
    const bytes = await renderCover({
      ...data,
      paymentType: "Milersättning",
      dateLabel: "Resdag",
      journey: {
        route: "Kårhuset, Lund → Snabbgross → Kårhuset, Lund",
        odometerStart: "12\u00a0300,0 km",
        odometerEnd: "12\u00a0342,0 km",
        distance: "42,0 km",
        rate: "2,50 kr/km",
      },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("fits a long multi-stop route without pushing the page over", async () => {
    // The errand that called at two places before going home, written out with
    // real addresses. `field` wraps, so this runs to a second line rather than
    // off the edge; what is asserted is that it stays one page.
    const bytes = await renderCover({
      ...data,
      paymentType: "Milersättning",
      dateLabel: "Resdag",
      journey: {
        route:
          "Kårhuset, Ole Römers väg 3, Lund → Snabbgross, Fältspatsvägen 4, Lund → " +
          "Systembolaget, Mobilia, Malmö → Kårhuset, Ole Römers väg 3, Lund",
        odometerStart: "12\u00a0300,0 km",
        odometerEnd: "12\u00a0388,0 km",
        distance: "88,0 km",
        rate: "2,50 kr/km",
      },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("draws a journey of dashes for a half-filled draft", async () => {
    const bytes = await renderCover({
      ...data,
      journey: {
        route: "–",
        odometerStart: "12\u00a0300,0 km",
        odometerEnd: "–",
        distance: "–",
        rate: "–",
      },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("breaks onto a second page rather than overflowing the first", async () => {
    // The bounded-table argument only holds for realistic utlägg. A section
    // that splits one across forty cost centres should still get a document.
    const many = Array.from({ length: 40 }, (_, i) => ({
      costCenter: `SEKT${String(i).padStart(2, "0")} – Verksamhet ${i}`,
      amount: "1 234,00 kr",
      comment: "En kommentar som är tillräckligt lång för att brytas över rader",
      approvedBy: "Ludwig Gehlsdorf",
      approvedAt: "2026-04-02",
    }));
    const doc = await PDFDocument.load(await renderCover({ ...data, allocations: many }));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("does not let a comment escape into the markup", async () => {
    // The data is handed over as JSON and read with `json()`, so a comment is a
    // string to Typst however it is punctuated, but this is the assertion that
    // would fail first if that ever became string interpolation.
    const bytes = await renderCover({
      ...data,
      allocations: [
        {
          ...data.allocations[0],
          comment: '#panic("nope") $sum_(i=1)^n$ \\ [] * _x_ @ref <label>',
        },
      ],
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
