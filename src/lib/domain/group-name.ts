// What counts as one of the section's Authentik groups, and the one form of it
// everything compares.
//
// Domain vocabulary rather than server code, because both halves need it: the
// sign-in derivation (lib/server/authentik-roles.ts) and the settings screen
// that edits the mapping, which has to be able to say "that is not ours" before
// sending a row the API would only refuse.

// Any group under `dsek.` at all means a functionary of the section. Groups
// outside it (`authentik Admins`, the alumni association's `dchip.*` tree)
// are not ours to read. Retired positions are prefixed `old.` upstream and so
// fall outside too, which is what we want: a mandate that ended is not a
// mandate.
//
// The one authority rule that is not editable on a screen, and the reason it is
// not: everything else on Inställningar → Roller decides what a group of ours
// confers, while this decides whether a name is ours at all. A row naming
// `authentik Admins` can be typed; it still grants nothing, because the
// derivation tests this before it looks anything up.
const SECTION = /^dsek(\.|$)/;

/** Normalised the one way every comparison is made. */
export const normaliseGroup = (group: string) => group.trim().toLowerCase();

/** Whether a group name is one this app will ever grant anything for. */
export const isSectionGroup = (group: string) => SECTION.test(normaliseGroup(group));
