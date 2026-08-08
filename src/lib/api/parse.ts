// Reading a request body, once, in one shape.
//
// Every route used to open-code this: `typeof body.title === "string" ? … : …`,
// forty-odd times, each deciding for itself whether a missing field was a
// default or a refusal, whether a string got trimmed, and whether a number that
// arrived as `"12"` counted. Most of them agreed. The ones that didn't were not
// findable by reading, because there was nothing to compare against.
//
// A schema says it once, and says it in a form the client can share — see
// lib/api/schemas/, where each route's body is defined and its TypeScript type
// inferred from the same definition. The route gets a parsed, typed value; the
// caller gets a type that stops compiling when the two drift.
import { NextResponse } from "next/server";
import type { z } from "zod";
import { fail } from "./guard";

/**
 * The parsed body, or the response to send instead.
 *
 * Same `{ ok }` shape as `gate()`, so a handler reads top to bottom:
 *
 *     const g = await gate(canBookkeep);
 *     if (!g.ok) return g.res;
 *     const body = await parseBody(req, BookVoucher);
 *     if (!body.ok) return body.res;
 *     // body.data is typed, validated, and nothing below re-checks it
 */
export type Parsed<T> = { ok: true; data: T } | { ok: false; res: NextResponse };

/**
 * Which fields were wrong, as `"allocations.0.amount"` style paths.
 *
 * The client shows the message the error *code* resolves to, as with every
 * other failure — these are the detail underneath it, for the log and for
 * anyone reading the response by hand. Deliberately not prose: a validation
 * message from zod is English, and the reader's language is a cookie on their
 * request.
 */
const fieldPaths = (error: z.ZodError): string[] =>
  error.issues.map((i) => (i.path.length ? i.path.join(".") : "(body)"));

/**
 * Parse a request's JSON body against `schema`.
 *
 * A body that isn't JSON at all and a body that is the wrong shape are the same
 * answer — 422 with the code `request.invalidBody` — because to the caller they
 * are the same mistake, and because a handler that distinguishes them has to
 * say something about the difference that nobody acts on.
 */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    // No body, or not JSON. Schemas whose fields are all optional still accept
    // `{}`, which is what makes a bodyless POST work where it is meant to.
    raw = {};
  }
  return parseValue(raw, schema);
}

/**
 * The same, for a value already in hand — a query string turned into an object,
 * or a body a route read for itself before deciding which schema applies.
 */
export function parseValue<S extends z.ZodType>(raw: unknown, schema: S): Parsed<z.infer<S>> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };

  const fields = fieldPaths(result.error);
  return {
    ok: false,
    res: fail(422, "request.invalidBody", { values: { fields: fields.join(", ") } }),
  };
}
