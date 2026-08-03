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
