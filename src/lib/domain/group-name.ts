// What counts as one of the section's Authentik groups, in the one form everything compares. Needed by
// both sign-in (lib/server/authentik-roles.ts) and the settings screen. Any group under `dsek.` is a
// functionary; others (`authentik Admins`, `dchip.*`) and retired `old.` groups are not ours. This is
// the one non-editable authority rule: the derivation tests it before any lookup.
const SECTION = /^dsek(\.|$)/;

/** Normalised the one way every comparison is made. */
export const normaliseGroup = (group: string) => group.trim().toLowerCase();

/** Whether a group name is one this app will ever grant anything for. */
export const isSectionGroup = (group: string) => SECTION.test(normaliseGroup(group));
