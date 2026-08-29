import { describe, expect, it } from "vitest";
import { apiErrorAction, resolveApiError } from "./api-error";

// A stand-in for next-intl's translator: knows the keys it is given, and
// renders one by returning its value.
function translator(messages: Record<string, string>) {
  const t = ((key: string, values?: Record<string, string | number>) => {
    const raw = messages[key];
    if (raw === undefined) return key;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  }) as ((key: string, values?: Record<string, string | number>) => string) & {
    has: (key: string) => boolean;
  };
  t.has = (key: string) => key in messages;
  return t;
}

const t = translator({
  "errors.expense.payoutRequired": "Lägg till clearing- och kontonummer i Min profil innan du skickar in",
  "errors.expense.costCenterRequired": "Välj minst ett kostnadsställe",
  "common.action.goToProfile": "Till Min profil",
});

describe("apiErrorAction", () => {
  it("points a missing payout account at the profile", () => {
    expect(apiErrorAction(t, { error: "expense.payoutRequired" })).toEqual({
      href: "/profile",
      label: "Till Min profil",
    });
  });

  it("offers nothing for a failure with nowhere to go", () => {
    // The ordinary case: an error the reader fixes where they already are.
    expect(apiErrorAction(t, { error: "expense.costCenterRequired" })).toBeNull();
    expect(apiErrorAction(t, {})).toBeNull();
    expect(apiErrorAction(t, null)).toBeNull();
  });

  it("does not invent an action for an unknown code", () => {
    expect(apiErrorAction(t, { error: "something.new" })).toBeNull();
  });

  it("still resolves the message it accompanies", () => {
    // The two are read off the same body and must agree about the same failure.
    const body = { error: "expense.payoutRequired" };
    expect(resolveApiError(t, body)).toContain("Min profil");
    expect(apiErrorAction(t, body)?.href).toBe("/profile");
  });
});
