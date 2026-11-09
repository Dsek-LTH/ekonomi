// Reads a request body once, in one shape: each route's schema lives in lib/api/schemas/ and its type is inferred from it.
import { NextResponse } from "next/server";
import type { z } from "zod";
import { fail } from "./guard";

/**
 * The parsed body, or the response to send instead. Same `{ ok }` shape as `gate()`:
 *
 *     const body = await parseBody(req, BookVoucher);
 *     if (!body.ok) return body.res;
 */
export type Parsed<T> = { ok: true; data: T } | { ok: false; res: NextResponse };

/** Which fields were wrong, as `"allocations.0.amount"` paths. For the log, not prose (zod messages are English). */
const fieldPaths = (error: z.ZodError): string[] =>
  error.issues.map((i) => (i.path.length ? i.path.join(".") : "(body)"));

/** Parses a request's JSON body against `schema`. Non-JSON and wrong shape are the same 422 `request.invalidBody`. */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    // No body or not JSON. Schemas with all-optional fields still accept `{}`, so a bodyless POST works.
    raw = {};
  }
  return parseValue(raw, schema);
}

/** The same for a value already in hand (a query string, or a body read before choosing the schema). */
function parseValue<S extends z.ZodType>(raw: unknown, schema: S): Parsed<z.infer<S>> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };

  const fields = fieldPaths(result.error);
  return {
    ok: false,
    res: fail(422, "request.invalidBody", { values: { fields: fields.join(", ") } }),
  };
}
