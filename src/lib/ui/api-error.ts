// Client half of the API error contract in lib/api/guard.ts. Unknown codes are shown verbatim
// (Fortnox sends its own error text, which has no key).

/** The subset of next-intl's translator this needs. */
type Translator = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

type ErrorValue = string | number | { key: string };

const isKeyRef = (v: ErrorValue): v is { key: string } =>
  typeof v === "object" && v !== null && typeof (v as { key?: unknown }).key === "string";

/** Failures whose message names a place the reader can fix it, mapped to that place. The label is a message key. */
const API_ERROR_ACTIONS: Readonly<Record<string, { href: string; label: string }>> = {
  "expense.payoutRequired": { href: "/profile", label: "common.action.goToProfile" },
  // A setting nobody has chosen yet: link to where it is chosen.
  "settings.bankAccountUnset": { href: "/admin/fortnox", label: "common.action.goToSettings" },
  "settings.memberDebtAccountUnset": {
    href: "/admin/fortnox",
    label: "common.action.goToSettings",
  },
  "settings.voucherSeriesUnset": { href: "/admin/fortnox", label: "common.action.goToSettings" },
  "settings.zettleClearingAccountUnset": {
    href: "/admin/income",
    label: "common.action.goToSettings",
  },
  "settings.swishClearingAccountUnset": {
    href: "/admin/income",
    label: "common.action.goToSettings",
  },
  "settings.zettleFeeAccountUnset": {
    href: "/admin/income",
    label: "common.action.goToSettings",
  },
};

/** Where the reader should go to fix this failure, or null. */
export function apiErrorAction(
  t: Translator,
  body: unknown,
): { href: string; label: string } | null {
  const code = (body as { error?: unknown } | null)?.error;
  if (typeof code !== "string") return null;
  const action = API_ERROR_ACTIONS[code];
  if (!action) return null;
  return { href: action.href, label: t.has(action.label) ? t(action.label) : action.label };
}

/** Resolves the `{ error, errorValues }` of a failed response into a message, or null when there is no error. */
export function resolveApiError(t: Translator, body: unknown): string | null {
  const data = (body ?? {}) as { error?: unknown; errorValues?: Record<string, ErrorValue> };
  if (typeof data.error !== "string" || !data.error) return null;

  const key = `errors.${data.error}`;
  if (!t.has(key)) return data.error;

  // A value may itself be a message key, an enum in the middle of a sentence.
  const values = Object.fromEntries(
    Object.entries(data.errorValues ?? {}).map(([k, v]) => [
      k,
      isKeyRef(v) ? (t.has(v.key) ? t(v.key) : v.key) : v,
    ]),
  );
  return t(key, values);
}
