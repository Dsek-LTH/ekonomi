// A cost centre's short name: what it is called where its result unit is already named above it.
// Suggesting one is only a proposal (settings saves nothing until confirmed); drawing one falls back to the full name.

export const SHORT_NAME_MAX = 60;

// What may stand between the unit's name and the rest: hyphen, colon, slash, or an en or em dash (names are typed in Fortnox).
const SEPARATOR = /^\s*[-:/\u2013\u2014]\s*/;

/** The name with its result unit's name taken off the front, or null. Only an exact prefix followed by a separator counts, ignoring case and spacing: "Sexmästeriets fond" under Sexmästeriet is not "s fond". */
export function suggestShortName(
  name: string,
  resultUnit: string | null | undefined,
): string | null {
  const unit = resultUnit?.trim();
  if (!unit) return null;
  const full = name.trim();
  if (full.slice(0, unit.length).toLocaleLowerCase("sv") !== unit.toLocaleLowerCase("sv"))
    return null;
  const after = full.slice(unit.length);
  const sep = SEPARATOR.exec(after);
  if (!sep) return null;
  const rest = after.slice(sep[0].length).trim();
  return rest ? rest.slice(0, SHORT_NAME_MAX) : null;
}

export const nameUnderUnit = (cc: { name: string; shortName?: string | null }): string =>
  cc.shortName?.trim() || cc.name;
