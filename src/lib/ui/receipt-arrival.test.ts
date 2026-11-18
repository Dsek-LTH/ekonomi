import { describe, expect, it } from "vitest";
import { NO_PANEL, arrivalAction, type PanelState } from "./receipt-arrival";

const dropzone: PanelState = { source: true, receipt: false, awaiting: true, docs: "" };
const doc = (src: string): PanelState => ({
  source: true,
  receipt: true,
  awaiting: false,
  docs: src,
});
const phone = { phone: true, openOnChange: false };
const desk = { phone: false, openOnChange: false };
const inkorgPhone = { phone: true, openOnChange: true };
const inkorgDesk = { phone: false, openOnChange: true };

describe("the Inkorg, where picking a document is asking to read it", () => {
  it("opens the first document picked on a phone, from the dropzone or from nothing", () => {
    expect(arrivalAction(dropzone, doc("a"), inkorgPhone)).toBe("open");
    expect(arrivalAction(NO_PANEL, doc("a"), inkorgPhone)).toBe("open");
  });

  it("opens every other document picked after it, the same way", () => {
    expect(arrivalAction(doc("a"), doc("b"), inkorgPhone)).toBe("open");
    expect(arrivalAction(doc("a"), doc("b"), inkorgDesk)).toBe("open");
  });

  it("leaves it be when the documents did not change (a re-render, an upload finishing elsewhere)", () => {
    expect(arrivalAction(doc("a"), doc("a"), inkorgPhone)).toBeNull();
  });

  it("does not open on going back to the empty Inkorg", () => {
    expect(arrivalAction(doc("a"), NO_PANEL, inkorgPhone)).toBeNull();
  });
});

describe("any other page, as before", () => {
  it("folds a receipt arriving on a phone, so the page is read first", () => {
    expect(arrivalAction(NO_PANEL, doc("a"), phone)).toBe("fold");
    expect(arrivalAction(dropzone, doc("a"), phone)).toBe("fold");
  });

  it("opens the dropzone on a phone when there is nothing yet to show", () => {
    expect(arrivalAction(NO_PANEL, dropzone, phone)).toBe("unfold");
  });

  it("opens a receipt that arrives after the dropzone on a wide screen, and otherwise leaves it", () => {
    expect(arrivalAction(dropzone, doc("a"), desk)).toBe("unfold");
    expect(arrivalAction(NO_PANEL, doc("a"), desk)).toBeNull();
    expect(arrivalAction(doc("a"), doc("b"), desk)).toBeNull();
  });
});
