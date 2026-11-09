// Authentik group list to roles and result units. Both are written only at sign-in (src/auth.ts)
// and when a mapping edit calls `reapplyGrants`.
import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/server/db";
import { isSectionGroup, normaliseGroup } from "@/lib/domain/group-name";
import type { Role } from "@/lib/domain/types";

/** Everything a group list confers. */
export interface Grants {
  roles: Role[];
  /** ResultUnit *names*, matched against ResultUnit.name. */
  resultUnits: string[];
}

/** The same answer with the group(s) each role and result unit came out of. */
interface GrantSources {
  /** The section groups this was read from, normalised and deduped, in order. */
  groups: string[];
  /** Each role granted, and the groups behind it. ORDINARIE has none. */
  roles: { role: Role; groups: string[] }[];
  /** Each result unit answered for, and the groups that hand it over. */
  resultUnits: { unit: string; groups: string[] }[];
  /** Groups of ours in the list that the mapping grants nothing for. */
  silentGroups: string[];
}

/** What each group confers, as one lookup, so the derivation is a pure function of it. */
type GroupMapping = ReadonlyMap<string, { roles: readonly Role[]; resultUnits: readonly string[] }>;

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
 * What a group list confers and why, given a mapping. Pure.
 *
 * Roles always include ORDINARIE (a floor with no group behind it). A group mapped to a result
 * unit also confers RESULTATANSVARIG. Unknown groups are ignored but reported in `silentGroups`.
 */
export function explainGrants(
  mapping: GroupMapping,
  groups: readonly string[] | undefined,
): GrantSources {
  const roles = new Map<Role, string[]>([["ORDINARIE", []]]);
  const units = new Map<string, string[]>();
  const seen: string[] = [];
  const silent: string[] = [];

  const note = <K>(into: Map<K, string[]>, key: K, group: string) => {
    const behind = into.get(key);
    if (!behind) into.set(key, [group]);
    else if (!behind.includes(group)) behind.push(group);
  };

  for (const raw of groups ?? []) {
    const group = normaliseGroup(raw);
    if (!isSectionGroup(group)) continue;
    if (seen.includes(group)) continue;
    seen.push(group);

    const grant = mapping.get(group);
    if (!grant || (grant.roles.length === 0 && grant.resultUnits.length === 0)) {
      silent.push(group);
      continue;
    }

    for (const role of grant.roles) note(roles, role, group);
    if (grant.resultUnits.length > 0) note(roles, "RESULTATANSVARIG", group);
    for (const unit of grant.resultUnits) note(units, unit, group);
  }

  return {
    groups: seen,
    roles: [...roles].map(([role, behind]) => ({ role, groups: behind })),
    resultUnits: [...units]
      .map(([unit, behind]) => ({ unit, groups: behind }))
      .sort((a, b) => a.unit.localeCompare(b.unit, "sv")),
    silentGroups: silent,
  };
}

/** What a group list confers, given a mapping. Pure. */
export function deriveGrants(mapping: GroupMapping, groups: readonly string[] | undefined): Grants {
  const sources = explainGrants(mapping, groups);
  return {
    roles: sources.roles.map((r) => r.role),
    resultUnits: sources.resultUnits.map((u) => u.unit),
  };
}

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

/** The mapping, deduped per request. */
export const groupMapping = cache(() => mappingRows(prisma));

/** What a group list confers, against the mapping as it currently stands. */
export async function grantsFromGroups(groups: readonly string[] | undefined): Promise<Grants> {
  return deriveGrants(await groupMapping(), groups);
}

/** The section groups worth keeping on User.authentikGroups, out of everything Authentik sent. */
export const sectionGroups = (groups: readonly string[] | undefined): string[] =>
  [...new Set((groups ?? []).map(normaliseGroup).filter(isSectionGroup))].sort();

/**
 * Re-derive roles and result units for everyone a mapping change touches, from
 * `User.authentikGroups`. Users with an empty list are left alone (no information, not "no groups").
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

  // Grouped by grant shape and written a bucket at a time: a row-per-member loop times out the
  // interactive transaction and holds User locks that sign-ins queue behind.
  const buckets = new Map<string, { ids: string[]; roles: Role[]; resultUnits: string[] }>();
  for (const user of users) {
    const next = deriveGrants(mapping, user.authentikGroups);
    if (same(user.roles, next.roles) && same(user.resultUnits, next.resultUnits)) continue;

    // Sorted to key on. NUL-joined because no enum member can contain one.
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
