// A cost centre's short name: what it is called where its result unit is
// already named on screen above it. See `shortName` on CostCenter in the
// schema.
//
// Two halves, and only the second runs when a name is drawn. Suggesting one is
// a rule, and a rule is only ever a proposal: the settings page shows what it
// would set and saves nothing until somebody says so. Drawing one is no rule
// at all: the stored short name if there is one, the full name if there is
// not. So nothing on screen depends on a naming convention a section may not
// follow.

/** Max length of a short name, the same order as Fortnox's own names. */
export const SHORT_NAME_MAX = 60;

// What may stand between the unit's name and the rest: a hyphen, a colon or a
// slash, with any spacing. An en dash and an em dash too, since names are typed
// in Fortnox and either may arrive from there.
const SEPARATOR = /^\s*[-:/\u2013\u2014]\s*/;

/**
 * The name with its result unit's name taken off the front, or null when
 * there is nothing to suggest.
 *
 * Only an exact prefix of the unit's own name followed by a separator counts,
 * ignoring case and spacing: "Aktivitetsutskottet - Funktionärer" under
 * Aktivitetsutskottet is "Funktionärer". "Sexmästeriets fond" under
 * Sexmästeriet is not "s fond", since no separator follows, and a name that is
 * only the unit's name has nothing left to be called.
 */
export function suggestShortName(name: string, resultUnit: string | null | undefined): string | null {
  const unit = resultUnit?.trim();
  if (!unit) return null;
  const full = name.trim();
  if (full.slice(0, unit.length).toLocaleLowerCase("sv") !== unit.toLocaleLowerCase("sv")) return null;
  const after = full.slice(unit.length);
  const sep = SEPARATOR.exec(after);
  if (!sep) return null;
  const rest = after.slice(sep[0].length).trim();
  return rest ? rest.slice(0, SHORT_NAME_MAX) : null;
}

/** The name to draw under a result unit's heading. */
export const nameUnderUnit = (cc: { name: string; shortName?: string | null }): string =>
  cc.shortName?.trim() || cc.name;
