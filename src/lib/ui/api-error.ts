// The client half of the API error contract in lib/api/guard.ts: routes answer
// with a message *code* plus optional values, and the reader's locale turns it
// into a sentence here.
//
// Unknown codes are shown verbatim rather than swallowed. Some error text never
// passes through our messages at all — Fortnox sends its own, and a route that
// relays it has nothing to key on — so "not a known code" has to stay a working
// case and not a bug.

/** The subset of next-intl's translator this needs. */
type Translator = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

type ErrorValue = string | number | { key: string };

const isKeyRef = (v: ErrorValue): v is { key: string } =>
  typeof v === "object" && v !== null && typeof (v as { key?: unknown }).key === "string";

/**
 * Failures whose message names a place, mapped to that place.
 *
 * Only for the ones a person can act on themselves and immediately: the point
 * is to remove a navigation the reader would otherwise do from memory, not to
 * decorate every error with a link. `expense.payoutRequired` is the case that
 * asked for it — you are stopped mid-submission and told to go and fill in two
 * fields somewhere else, and the fastest route there was the browser's back
 * button once you had found it.
 *
 * The label is a message key, resolved by the caller in the reader's locale.
 */
const API_ERROR_ACTIONS: Readonly<Record<string, { href: string; label: string }>> = {
  "expense.payoutRequired": { href: "/profile", label: "common.action.goToProfile" },
};

/**
 * Where the reader should go to fix this failure, or null when there is nothing
 * to point at — which is the ordinary case.
 */
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

/**
 * Resolve the `{ error, errorValues }` of a failed response into a message.
 * Returns null when the body carried no error at all, so the caller can fall
 * back to its own wording.
 */
export function resolveApiError(t: Translator, body: unknown): string | null {
  const data = (body ?? {}) as { error?: unknown; errorValues?: Record<string, ErrorValue> };
  if (typeof data.error !== "string" || !data.error) return null;

  const key = `errors.${data.error}`;
  if (!t.has(key)) return data.error;

  // A value may itself be a message key — an enum in the middle of a sentence.
  const values = Object.fromEntries(
    Object.entries(data.errorValues ?? {}).map(([k, v]) => [
      k,
      isKeyRef(v) ? (t.has(v.key) ? t(v.key) : v.key) : v,
    ]),
  );
  return t(key, values);
}
