import { describe, expect, it } from "vitest";

import { wizardChrome, type WizardTitles } from "./wizard-chrome";
import type { Expense } from "@/lib/domain/types";

// A translator that echoes the key, so a test asserts *which sentence* was
// chosen rather than what it happens to say in Swedish this month.
const t = ((key: string, values?: { id: string }) =>
  values ? `${key}:${values.id}` : key) as WizardTitles;

const claim = (over: Partial<Expense> = {}) =>
  ({ id: "exp1", reference: "U-2026-0042", ...over }) as Expense;

describe("wizardChrome", () => {
  it("names a new claim and sends back to the list", () => {
    const c = wizardChrome({ existing: undefined, t });
    expect(c.title).toBe("newTitle");
    expect(c.description).toBe("newDescription");
    expect(c.back).toBe("/expenses");
  });

  it("names an edited claim by its reference, and goes back to it", () => {
    const c = wizardChrome({ existing: claim(), t });
    expect(c.title).toBe("editTitle:U-2026-0042");
    expect(c.description).toBe("editDescription");
    expect(c.back).toBe("/expenses/exp1");
  });

  it("has another word for a draft, which has no reference yet", () => {
    // A claim is numbered when it is submitted for attest, not when it is
    // started, so an edit of a draft cannot name it and must not try.
    const c = wizardChrome({ existing: claim({ reference: undefined }), t });
    expect(c.title).toBe("editTitleDraft");
    expect(c.back).toBe("/expenses/exp1");
  });
});
