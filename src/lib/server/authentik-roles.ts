// Authentik group list → what a person may do here.
//
// Authentik is where the section's mandates already live: holding a post means
// being in a group named after it, and the group goes away when the mandate
// does. That makes it the right source for authority — nobody has to remember
// to revoke anything here at a handover.
//
// The group names are the guild's position ids, the same strings their own web
// app matches on (Dsek-LTH/web, src/lib/utils/committee-ordering/enums.ts is
// the catalogue; src/routes/(app)/expenses/config.ts is who signs what).
//
// Two things come out of a group list, and they are different in kind:
//
//   • ROLES — what someone is. Stored on User.roles.
//   • RESULT UNITS — whose money someone answers for. Stored on
//     User.resultUnits, as result unit *names*.
//
// Both are written at sign-in, and only at sign-in (src/auth.ts) — a session
// cookie cannot be rewritten from a Server Component, so there is no second
// moment at which this could run by itself. That is what fixes the session at a
// day. The one other moment is deliberate: an edit to the mapping recomputes
// everyone it touches on the spot (`reapplyGrants` below), so a correction does
// not wait a day for its subjects to sign in.
//
// The mapping itself used to be three tables in this file. It is rows now
// (GroupRole, GroupResultUnit) because the section edits it — a committee is
// renamed, a unit is handed to someone who is not its head. What is still code
// is the vocabulary: the Role enum, and the rule below about which groups are
// even ours to read.
import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/server/db";
import { isSectionGroup, normaliseGroup } from "@/lib/domain/group-name";
import type { Role } from "@/lib/domain/types";

/** Everything a group list confers. */
export interface Grants {
  roles: Role[];
  /** ResultUnit *names* — matched against ResultUnit.name. */
  resultUnits: string[];
}

// Which names are the section's, and the form they are compared in, live in
// lib/domain/group-name.ts — the settings screen that edits this mapping needs
// the same rule, and it runs in the browser.


/**
 * What each group confers, as one lookup.
 *
 * Held as a plain map rather than queried per group so the derivation below can
 * be a pure function of it — which is what lets the whole policy be tested
 * without a database (authentik-roles.test.ts), and what lets a mapping edit
 * re-derive everybody from the transaction's own view of the tables rather than
 * from a request cache that is one write out of date.
 */
export type GroupMapping = ReadonlyMap<
  string,
  { roles: readonly Role[]; resultUnits: readonly string[] }
>;

/** Build the lookup from the two tables' rows, in either caller's shape. */
export function buildMapping(
  roleRows: readonly { group: string; role: Role }[],
  unitRows: readonly { group: string; unit: string }[],
): GroupMapping {
  const map = new Map<string, { roles: Role[]; resultUnits: string[] }>();
  const entry = (group: string) => {
    const existing = map.get(group);
    if (existing) return existing;
    const fresh = { roles: [] as Role[], resultUnits: [] as string[] };
    map.set(group, fresh);
    return fresh;
  };

  for (const { group, role } of roleRows) entry(normaliseGroup(group)).roles.push(role);
  for (const { group, unit } of unitRows) entry(normaliseGroup(group)).resultUnits.push(unit);
  return map;
}

/**
 * What a group list confers, given a mapping. Pure.
 *
 * Roles always include ORDINARIE: every signed-in member may submit their own
 * utlägg, and a role set that could come back empty would mean a person who is
 * authenticated and yet cannot use the app. It is a floor, not a mapping row —
 * there is no row to take it away with, deliberately.
 *
 * A group that maps to a result unit also confers RESULTATANSVARIG. The role
 * and the reach come from the same row, so neither can be granted without the
 * other, and no screen can produce a resultatansvarig who answers for nothing.
 *
 * Unknown groups are ignored rather than rejected — Authentik gains groups for
 * reasons that have nothing to do with this app, and none of them should be an
 * error here.
 */
export function deriveGrants(
  mapping: GroupMapping,
  groups: readonly string[] | undefined,
): Grants {
  const roles = new Set<Role>(["ORDINARIE"]);
  const resultUnits = new Set<string>();

  for (const raw of groups ?? []) {
    const group = normaliseGroup(raw);
    if (!isSectionGroup(group)) continue;

    const grant = mapping.get(group);
    if (!grant) continue;

    for (const role of grant.roles) roles.add(role);
    if (grant.resultUnits.length > 0) roles.add("RESULTATANSVARIG");
    for (const unit of grant.resultUnits) resultUnits.add(unit);
  }

  return {
    roles: [...roles],
    resultUnits: [...resultUnits].sort((a, b) => a.localeCompare(b, "sv")),
  };
}

// ── The database half ─────────────────────────────────────────────

const mappingRows = async (
  tx: Pick<typeof prisma, "groupRole" | "groupResultUnit">,
): Promise<GroupMapping> => {
  const [roleRows, unitRows] = await Promise.all([
    tx.groupRole.findMany({ select: { group: true, role: true } }),
    tx.groupResultUnit.findMany({
      select: { group: true, resultUnit: { select: { name: true } } },
    }),
  ]);
  return buildMapping(
    roleRows,
    unitRows.map((r) => ({ group: r.group, unit: r.resultUnit.name })),
  );
};

/**
 * The mapping, deduped per request.
 *
 * Read whole rather than queried per group: it is a few dozen rows, a sign-in
 * needs most of them anyway, and the settings screen renders the same object
 * the sign-in gates on.
 */
export const groupMapping = cache(() => mappingRows(prisma));

/** What a group list confers, against the mapping as it currently stands. */
export async function grantsFromGroups(groups: readonly string[] | undefined): Promise<Grants> {
  return deriveGrants(await groupMapping(), groups);
}

/**
 * The section groups worth keeping on a User row, out of everything Authentik
 * sent. Stored so the derivation can be run again without the person present —
 * see User.authentikGroups.
 *
 * Filtered rather than stored whole: the rest is somebody else's business, and a
 * column that quietly accumulated every group a member is in anywhere would be a
 * small pile of personal data this app has no use for.
 */
export const sectionGroups = (groups: readonly string[] | undefined): string[] =>
  [...new Set((groups ?? []).map(normaliseGroup).filter(isSectionGroup))].sort();

/**
 * Re-derive roles and result units for everyone a mapping change touches.
 *
 * The mapping is read at sign-in, so without this an edit would land on people
 * one at a time over the following day, in whatever order they happened to open
 * the app — the correction visible on the screen that made it and nowhere else.
 *
 * Runs against `User.authentikGroups`, which is why that column exists. Someone
 * who has not signed in since it was introduced has an empty list and is left
 * alone: we do not know their groups, and rewriting their roles from a blank
 * would be reading "no groups" out of "no information". Their next sign-in fixes
 * them, as it always did.
 *
 * Writes only where something actually changed. A mapping edit usually moves one
 * committee, and an unconditional write would be a row per member of the section
 * for it.
 */
export async function reapplyGrants(
  tx: Pick<typeof prisma, "user" | "groupRole" | "groupResultUnit">,
): Promise<number> {
  const [mapping, users] = await Promise.all([
    mappingRows(tx),
    tx.user.findMany({
      where: { authentikGroups: { isEmpty: false } },
      select: { id: true, authentikGroups: true, roles: true, resultUnits: true },
    }),
  ]);

  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && new Set([...a, ...b]).size === a.length;

  // Grouped by the grant they land on, then written a bucket at a time.
  //
  // A row-at-a-time loop is a round trip per member — and this runs inside an
  // interactive transaction, against a 5s default timeout, for a section with
  // about a thousand of them. A mapping edit that touched a broad group did not
  // fit, so it rolled back and reported nothing but "save failed": correct, and
  // impossible to act on. It also held write locks on User for the whole span,
  // which every concurrent sign-in queues behind (`syncAuthentikUser`).
  //
  // The section has far more members than it has distinct grant shapes — most
  // people are ORDINARIE and nothing else — and it is the shapes that decide how
  // many statements this costs.
  const buckets = new Map<string, { ids: string[]; roles: Role[]; resultUnits: string[] }>();
  for (const user of users) {
    const next = deriveGrants(mapping, user.authentikGroups);
    if (same(user.roles, next.roles) && same(user.resultUnits, next.resultUnits)) continue;

    // `resultUnits` comes out of deriveGrants sorted; `roles` comes out of a Set
    // in insertion order, so it is sorted here to key on. NUL-joined because no
    // enum member can contain one.
    const key = `${[...next.roles].sort().join(",")}\u0000${next.resultUnits.join(",")}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.ids.push(user.id);
    else buckets.set(key, { ids: [user.id], roles: next.roles, resultUnits: next.resultUnits });
  }

  let changed = 0;
  for (const { ids, roles, resultUnits } of buckets.values()) {
    await tx.user.updateMany({ where: { id: { in: ids } }, data: { roles, resultUnits } });
    changed += ids.length;
  }

  return changed;
}
