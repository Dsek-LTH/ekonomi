// Authentik group list → our Role enum.
//
// Authentik is where the section's mandates already live: holding a post means
// being in a group named after it, and the group goes away when the mandate
// does. That makes it the right source for roles — nobody has to remember to
// revoke anything here at a handover — and it makes this file the whole of the
// translation between their vocabulary and ours.
//
// The group names are the guild's position ids, the same strings their own web
// app matches on (`dsek.skattm.mastare`, `dsek.ordf`, and `dsek.<utskott>.
// mastare` as the signer of that committee's cost centres — see
// Dsek-LTH/web src/routes/(app)/expenses/config.ts and signers.ts).
//
// Where the roles are read: nowhere near here. This produces the value stored
// on User.roles, and every authority question is answered from that column on
// the request that asks it (lib/server/current-user.ts). A group list in a
// token is a claim about the moment the token was minted; this file is what
// turns it into a fact with a row behind it.
import type { Role } from "@/lib/domain/types";

// Exact-match groups. Ordered most senior first, purely so the list reads as
// the hierarchy it is.
//
// TODO(verify): the two vice/förman entries are guesses — the guild's public
// code only names `dsek.skattm.mastare` and `dsek.ordf` outright. Check the
// real names in Authentik (auth.dsek.se, or the `groups` claim of your own
// token) and correct them here. A wrong name is not dangerous: it grants
// nothing, and whoever holds the post falls back to ORDINARIE.
const EXACT: ReadonlyArray<readonly [group: string, role: Role]> = [
  ["dsek.ordf", "ORDFORANDE"],
  ["dsek.skattm.mastare", "SKATTMASTARE"],
  ["dsek.skattm.vice", "VICE_SKATTMASTARE"], // TODO(verify)
  ["dsek.skattm.forman", "SKATTFORMAN"], // TODO(verify)
];

// The committee heads. Each of these signs their own committee's cost centres
// in the guild's expense flow, which is exactly what RESULTATANSVARIG means
// here — with one difference that matters: *which* result units a person
// answers for is not read off the group. That stays an explicit link in
// settings (ResultUnitOwner), because a committee name and a cost-centre code
// prefix don't correspond one-to-one, and a wrong guess would silently hand
// somebody attest rights over money that isn't theirs. So the group grants the
// role; the link grants the reach.
const HEAD_OF_COMMITTEE = /^dsek\.[a-z0-9]+\.(mastare|ordf)$/;

// Any group under `dsek.` at all means a functionary of the section, which is
// what ORDINARIE is. Everyone who can sign in gets it regardless (see below) —
// this constant is here to name the idea, not to gate it.
const SECTION = /^dsek(\.|$)/;

/**
 * The roles a group list grants. Always includes ORDINARIE: every signed-in
 * member may submit their own utlägg, and a role set that could come back
 * empty would mean a person who is authenticated and yet cannot use the app.
 *
 * Unknown groups are ignored rather than rejected — Authentik gains groups for
 * reasons that have nothing to do with this app, and none of them should be an
 * error here.
 */
export function rolesFromGroups(groups: readonly string[] | undefined): Role[] {
  const held = new Set<Role>(["ORDINARIE"]);

  for (const raw of groups ?? []) {
    const group = raw.trim().toLowerCase();
    if (!SECTION.test(group)) continue;

    for (const [name, role] of EXACT) if (group === name) held.add(role);
    if (HEAD_OF_COMMITTEE.test(group) && !EXACT.some(([n]) => n === group)) {
      held.add("RESULTATANSVARIG");
    }
  }

  return [...held];
}

/**
 * Whether two role sets are the same, order disregarded. Used to skip a write
 * when a token refresh finds nothing changed, which is the normal case.
 */
export function sameRoles(a: readonly Role[], b: readonly Role[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((role) => set.has(role));
}
