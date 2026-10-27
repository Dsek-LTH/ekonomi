// What the app reads out of a mail forwarded to the levfaktura inkorg, and
// what it decides from it. Pure: the Gmail side is lib/server/gmail.ts, the
// writing is lib/server/inbound-mail.ts, and everything they found is handed
// in here so the rules can be read, and tested, without either.

// ── Who sent it ───────────────────────────────────────────────────

/** `"Anna Berg" <anna.berg@dsek.se>` → its address (lower-cased) and name. */
export function parseAddress(header: string | null | undefined): {
  address: string;
  name: string | null;
} | null {
  if (!header) return null;
  const angled = header.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (angled) {
    const name = angled[1]?.trim() || null;
    return { address: angled[2].toLowerCase(), name };
  }
  const bare = header.trim().match(/^[^\s<>]+@[^\s<>]+$/);
  return bare ? { address: bare[0].toLowerCase(), name: null } : null;
}

/** One `method=result` from an Authentication-Results header, with its
 *  properties: `dkim=pass header.i=@dsek.se` → { method, result, props }. */
interface AuthResult {
  method: string;
  result: string;
  props: Record<string, string>;
}

/**
 * The Authentication-Results header Gmail itself added, parsed. Null when
 * there is none from Gmail.
 *
 * Only Gmail's, and only the topmost: a header further down was there when the
 * mail arrived, which means whoever sent it could have written it. Gmail
 * prepends its own, and the Gmail API returns headers in the order they stand
 * in the mail, so the first one naming mx.google.com is the one Gmail wrote.
 */
export function gmailAuthResults(headers: readonly string[]): AuthResult[] | null {
  const ours = headers.find((h) => h.trim().toLowerCase().startsWith("mx.google.com"));
  if (!ours) return null;
  return ours
    .split(";")
    .slice(1)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      // Comments in parentheses say nothing the properties do not.
      const clean = part.replace(/\([^)]*\)/g, " ");
      const [head, ...rest] = clean.split(/\s+/).filter(Boolean);
      const eq = head?.indexOf("=") ?? -1;
      if (!head || eq < 1) return [];
      const props: Record<string, string> = {};
      for (const p of rest) {
        const i = p.indexOf("=");
        if (i > 0) props[p.slice(0, i).toLowerCase()] = p.slice(i + 1).toLowerCase();
      }
      return [{ method: head.slice(0, eq).toLowerCase(), result: head.slice(eq + 1).toLowerCase(), props }];
    });
}

export type RejectReason = "noSender" | "foreignDomain" | "notAuthenticated";

/**
 * Why a mail is refused, or null when it is taken.
 *
 * Two questions. Is it from the section's own domain (only members forward
 * invoices in; a supplier writing to the address directly is not a way in), and
 * did Gmail check that it really was: DMARC passing for that domain, or failing
 * that a DKIM signature from it that verified. A From header on its own is a
 * line anyone can type.
 */
export function rejectReason(
  from: { address: string } | null,
  authResultsHeaders: readonly string[],
  domain: string,
): RejectReason | null {
  if (!from) return "noSender";
  const d = domain.toLowerCase();
  if (!from.address.endsWith(`@${d}`)) return "foreignDomain";

  const results = gmailAuthResults(authResultsHeaders) ?? [];
  const dmarc = results.some(
    (r) => r.method === "dmarc" && r.result === "pass" && r.props["header.from"] === d,
  );
  const dkim = results.some(
    (r) =>
      r.method === "dkim" &&
      r.result === "pass" &&
      (r.props["header.i"] === `@${d}` || r.props["header.d"] === d),
  );
  return dmarc || dkim ? null : "notAuthenticated";
}

// ── What it says ──────────────────────────────────────────────────

// The line a mail client puts between what the forwarder wrote and what they
// forwarded. Gmail's, in the two languages the section writes in, and the
// Outlook and Apple shapes, which open the quoted mail with its From line.
const FORWARD_MARKER =
  /^\s*(?:-{3,}\s*(?:forwarded message|vidarebefordrat meddelande|original message|ursprungligt meddelande)\s*-{3,}|begin forwarded message:|vidarebefordrat brev:)\s*$/im;
const OUTLOOK_HEADER = /^\s*(?:from|från):\s.+$/im;

/**
 * Split a forwarded mail's text into what the forwarder wrote and what was
 * forwarded, and read who the forwarded mail was from.
 *
 * Whatever comes first of the forward marker and a quoted From line is the
 * boundary. With neither, the whole text is the note: somebody who attached a
 * PDF to a fresh mail wrote nothing but the note.
 */
export function splitForward(text: string | null | undefined): {
  note: string | null;
  originalFrom: string | null;
} {
  if (!text) return { note: null, originalFrom: null };
  const marker = text.search(FORWARD_MARKER);
  const header = text.search(OUTLOOK_HEADER);
  const cut = [marker, header].filter((i) => i >= 0).sort((a, b) => a - b)[0];

  const noteText = (cut === undefined ? text : text.slice(0, cut)).trim();
  const quoted = cut === undefined ? "" : text.slice(cut);
  const fromLine = quoted.match(/^\s*(?:from|från):\s*(.+)$/im)?.[1] ?? null;
  // Gmail writes `From: Name <a@b.se>`, Outlook sometimes `Name [mailto:a@b.se]`.
  const mailto = fromLine?.match(/mailto:([^\]\s]+)/i)?.[1];
  const originalFrom = parseAddress(mailto ?? fromLine)?.address ?? null;

  return { note: noteText ? noteText.slice(0, 2000) : null, originalFrom };
}

/** A subject without the "Fwd:", "VB:", "Fw:" a forward put in front of it. */
export function cleanSubject(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const clean = subject.replace(/^(?:\s*(?:fwd?|vb|vs|sv|re|tr)\s*:\s*)+/i, "").trim();
  return clean || null;
}

// ── Whose it is ───────────────────────────────────────────────────

export type AutoRule = "costCenter" | "unitName" | "forwarder";

export interface AutoAssignment {
  resultUnitId: string;
  rule: AutoRule;
  /** What matched: the cost centre code, the unit's name, or the forwarder. */
  match: string;
}

/**
 * Which result unit a forwarded invoice goes to without anybody sorting it, or
 * null when nothing settles it. Optional by design: a forward that says nothing
 * lands in the inkorg as it would have anyway.
 *
 * In order, and the first that settles it wins:
 *
 *   1. a cost centre code in the note or subject ("SEX01"), when every code
 *      named belongs to the same unit;
 *   2. a unit named in so many words ("till Sexmästeriet"), when exactly one is;
 *   3. a forwarder who answers for exactly one unit.
 *
 * Two codes from different units, or two units named, is a forwarder telling a
 * person something, and the invoice is left for one. Nothing is guessed from
 * the supplier here. That is a suggestion shown to triage, not an assignment,
 * because one supplier often serves several units.
 */
export function autoAssign(args: {
  text: string;
  units: readonly { id: string; name: string }[];
  costCenters: readonly { code: string; resultUnitId: string | null }[];
  forwarderUnitIds: readonly string[];
}): AutoAssignment | null {
  const text = args.text;

  const codes = new Map(args.costCenters.map((c) => [c.code.toUpperCase(), c.resultUnitId]));
  const named = [...new Set((text.toUpperCase().match(/\b[A-ZÅÄÖ]{2,8}\d{1,4}\b/g) ?? []))].filter(
    (code) => codes.has(code),
  );
  if (named.length) {
    const units = new Set(named.map((c) => codes.get(c)));
    const [only] = [...units];
    if (units.size === 1 && only) return { resultUnitId: only, rule: "costCenter", match: named[0] };
    return null;
  }

  const lower = text.toLowerCase();
  const mentioned = args.units.filter((u) => {
    const name = u.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}])${name}($|[^\\p{L}])`, "u").test(lower);
  });
  if (mentioned.length === 1) {
    return { resultUnitId: mentioned[0].id, rule: "unitName", match: mentioned[0].name };
  }
  if (mentioned.length > 1) return null;

  if (args.forwarderUnitIds.length === 1) {
    const unit = args.units.find((u) => u.id === args.forwarderUnitIds[0]);
    if (unit) return { resultUnitId: unit.id, rule: "forwarder", match: unit.name };
  }
  return null;
}
