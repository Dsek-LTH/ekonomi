"use client";

// Settings → Roles. The two halves of authority, on one screen because they are
// one question read from either end.
//
//   Groups → roles     which Authentik group makes you what here
//   Roles → privileges what each of those roles may then do
//
// Everything else in the app derives from these two tables: a sign-in runs the
// first (lib/server/authentik-roles.ts) and every gate reads the second
// (lib/server/capabilities.ts). Which is why this screen does two things no
// other settings screen has to.
//
// It counts. Beside every group is how many people hold it, and beside every
// role how many people are in it, so "give ORDINARIE bookkeeping access" reads
// as the ~1000 people it actually is before it is saved rather than after. The
// counts come from User.authentikGroups (the group list as it stood at each
// person's last sign-in) which is also what lets a mapped group nobody holds
// be shown as what it almost certainly is: a typo, which grants nothing and
// says nothing while it does.
//
// And it confirms. Not everything. A tickbox that stopped to ask every time
// would train the reader to click through it, but the two changes that are
// hard to walk back: one that reaches a lot of people, and one that takes
// something away from a role the reader holds themselves.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/field";
import { MultiCombobox } from "@/components/ui/combobox";
import { Notice } from "@/components/ui/notice";
import { Tag } from "@/components/ui/status-pill";
import { EmptyNote } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { SearchInput } from "@/components/ui/search-input";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { CAPABILITIES, ROLES } from "@/lib/domain/permissions";
import { isSectionGroup } from "@/lib/domain/group-name";
import type { AuthorityData, GroupRow } from "@/lib/data/authority";
import type { Capability, Role } from "@/lib/domain/types";

/** How many people a change has to reach before it is worth stopping over. */
const MANY = 25;

/**
 * The slices of the group list, in the order they are offered.
 *
 * `mapped` and `unmapped` used to be two cards, one under the other. They are
 * one list now, because the question a reader arrives with is "what does
 * dsek.sex.bar.mstr do", and answering it should not start with working out
 * which of two lists that group is in.
 *
 * `silent` is a subset of `mapped`, not a fourth kind: a row that grants
 * something to a group nobody is in. Almost always a misspelling, and the one
 * slice worth going looking for, so it gets a tab of its own.
 */
const FILTERS = ["all", "mapped", "unmapped", "silent"] as const;
type GroupFilter = (typeof FILTERS)[number];

/** Whether a row confers anything at all. What separated the two old cards. */
const grants = (g: GroupRow) => g.roles.length > 0 || g.resultUnits.length > 0;

const inSlice = (g: GroupRow, filter: GroupFilter) => {
  if (filter === "mapped") return grants(g);
  if (filter === "unmapped") return !grants(g);
  if (filter === "silent") return grants(g) && g.holders === 0;
  return true;
};

export function RolesClient({
  groups,
  resultUnits,
  roleCapabilities,
  roleHolders,
  membersWithoutGroups,
  viewerRoles,
}: AuthorityData & { viewerRoles: Role[] }) {
  const t = useTranslations("admin.roles");
  const tRole = useTranslations("common.role");
  const tCap = useTranslations("common.capability");
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();

  const [newGroup, setNewGroup] = useState("");
  const [filter, setFilter] = useState<GroupFilter>("all");
  const [query, setQuery] = useState("");

  const unitOptions = useMemo(
    () => resultUnits.map((u) => ({ value: u.id, label: u.name })),
    [resultUnits],
  );

  // The grid as a set of "ROLE\0CAPABILITY" keys, one membership test per box,
  // rather than a scan of the pair list for each of the seven-by-twelve. NUL
  // rather than a space because no member of either enum can contain one,
  // whichever vocabulary grows.
  const ticked = useMemo(
    () => new Set(roleCapabilities.map((r) => `${r.role}\u0000${r.capability}`)),
    [roleCapabilities],
  );

  const capsOf = (role: Role) => CAPABILITIES.filter((c) => ticked.has(`${role}\u0000${c}`));

  // ── Groups → roles ──────────────────────────────────────────────

  async function saveGroup(row: GroupRow, next: { roles?: Role[]; resultUnitIds?: string[] }) {
    const roles = next.roles ?? row.roles;
    const resultUnitIds = next.resultUnitIds ?? row.resultUnits.map((u) => u.id);

    if (row.holders >= MANY) {
      const ok = await confirm({
        title: t("confirmManyTitle"),
        message: t("confirmManyBody", { group: row.group, count: row.holders }),
        confirmLabel: t("confirmManyAction"),
      });
      if (!ok) return;
    }

    const data = await mutate("/api/authority/groups", {
      key: `group-${row.group}`,
      method: "PUT",
      body: { group: row.group, roles, resultUnitIds },
      error: t("saveFailed"),
    });
    if (!data) return;
    const affected = (data as { affected?: number }).affected ?? 0;
    notify.success(affected > 0 ? t("savedAffecting", { count: affected }) : t("saved"));
  }

  async function addGroup() {
    const group = newGroup.trim().toLowerCase();
    if (!group) return;
    if (!isSectionGroup(group)) {
      notify.error(t("outsideSection", { group }));
      return;
    }
    if (groups.some((g) => g.group === group)) {
      notify.error(t("groupExists", { group }));
      return;
    }
    // Created empty and then edited in place, so a new row goes through exactly
    // the same save as an old one, and so a group added by mistake grants
    // nothing in the moment before it is removed again.
    const data = await mutate("/api/authority/groups", {
      key: "new-group",
      method: "PUT",
      body: { group, roles: [], resultUnitIds: [] },
      error: t("saveFailed"),
    });
    if (!data) return;
    setNewGroup("");
  }

  async function removeGroup(row: GroupRow) {
    const ok = await confirm({
      title: t("removeGroupTitle"),
      message: t("removeGroupBody", { group: row.group, count: row.holders }),
      confirmLabel: t("removeGroupAction"),
      tone: "danger",
    });
    if (!ok) return;

    const data = await mutate("/api/authority/groups", {
      key: `group-${row.group}`,
      method: "DELETE",
      body: { group: row.group },
      error: t("saveFailed"),
    });
    if (!data) return;
    const affected = (data as { affected?: number }).affected ?? 0;
    notify.success(affected > 0 ? t("savedAffecting", { count: affected }) : t("saved"));
  }

  // ── Roles → privileges ──────────────────────────────────────────

  async function toggleCapability(role: Role, capability: Capability) {
    const on = ticked.has(`${role}\u0000${capability}`);
    const next = on ? capsOf(role).filter((c) => c !== capability) : [...capsOf(role), capability];

    // Two questions worth stopping for, and no others.
    const holders = roleHolders[role] ?? 0;
    if (!on && holders >= MANY) {
      const ok = await confirm({
        title: t("confirmWideTitle"),
        message: t("confirmWideBody", {
          capability: tCap(capability),
          role: tRole(role),
          count: holders,
        }),
        confirmLabel: t("confirmWideAction"),
      });
      if (!ok) return;
    }
    if (on && viewerRoles.includes(role)) {
      const ok = await confirm({
        title: t("confirmOwnTitle"),
        message: t("confirmOwnBody", { capability: tCap(capability), role: tRole(role) }),
        confirmLabel: t("confirmOwnAction"),
        tone: "danger",
      });
      if (!ok) return;
    }

    await mutate("/api/authority/capabilities", {
      key: `cap-${role}-${capability}`,
      method: "PUT",
      body: { role, capabilities: next },
      error: t("saveFailed"),
    });
  }

  // ── What is on screen ───────────────────────────────────────────
  //
  // Search first, then the slice. That order is what lets the tabs carry counts
  // of the *matches* rather than of the whole list, so typing "bar" says how
  // many of the three groups it found grant nothing, and the tab that would
  // show you an empty list says so before you click it.
  //
  // The search reads the roles and result units as well as the name, because
  // "who is resultatansvarig for Sexmästeriet" is the same question from the
  // other end, and the name of the group answering it is the one thing the
  // reader does not know.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      [g.group, ...g.roles.map((r) => tRole(r)), ...g.resultUnits.map((u) => u.name)]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [groups, query, tRole]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f, searched.filter((g) => inSlice(g, f)).length]),
      ) as Record<GroupFilter, number>,
    [searched],
  );

  // Rows that grant something first, and `groups` arrives sorted by name, so a
  // sort on that one key alone leaves the alphabet intact inside each half.
  // The old two-card reading order, without the two cards.
  const rows = useMemo(
    () =>
      searched
        .filter((g) => inSlice(g, filter))
        .sort((a, b) => Number(grants(b)) - Number(grants(a))),
    [searched, filter],
  );

  return (
    <div className="space-y-5">
      {/* The counts on this screen are counts of people we have seen. Somebody
          who has not signed in since their group list started being kept is in
          none of them, and a number that quietly excluded a third of the
          section would be worse than no number. */}
      {membersWithoutGroups > 0 && (
        <Notice tone="info">{t("staleCounts", { count: membersWithoutGroups })}</Notice>
      )}

      {/* ── Groups → roles ─────────────────────────────────────── */}
      <Card>
        <CardHeader title={t("groupsTitle")} subtitle={t("groupsSubtitle")} />

        {/* Which slice of the list, on its own hairline under the header. The
            underline register (components/ui/filter-tabs.tsx). It is the right
            shape for this: the rows change, the list does not. */}
        <div className="border-b border-border px-inset">
          <FilterTabs
            options={FILTERS.map((f) => ({
              value: f,
              label: t(`filter.${f}`),
              badge: counts[f],
            }))}
            value={filter}
            onChange={setFilter}
            aria-label={t("filterLabel")}
          />
        </div>

        <div className="flex flex-col gap-3 border-b border-border px-inset py-3 sm:flex-row sm:items-center">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="sm:w-64"
          />
          {/* At the far end of the bar, and holding a button. Two text boxes on
              one line is a fair thing to worry about; what tells them apart is
              that one of them does something when you press Enter and the other
              only takes rows away. */}
          <div className="flex items-center gap-2 sm:ml-auto">
            <Input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="dsek.sex.mastare"
              aria-label={t("addGroupLabel")}
              size="sm"
              className="w-full font-mono sm:w-52"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void addGroup();
              }}
            />
            <Button size="sm" onClick={addGroup} disabled={pending === "new-group"}>
              <IconPlus className="size-4" />
              {t("addGroup")}
            </Button>
          </div>
        </div>

        <CardBody>
          {/* Said where it is needed rather than over the whole list: a page
              full of groups that grant nothing reads as a page full of mistakes
              until somebody tells you that most of the section's groups are
              meant to mean nothing here. */}
          {filter === "unmapped" && rows.length > 0 && (
            <p className="mb-3 text-xs text-muted">{t("unmappedHint")}</p>
          )}

          {rows.length === 0 ? (
            <EmptyNote>{groups.length === 0 ? t("noGroups") : t("noMatches")}</EmptyNote>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <GroupEditor
                  key={row.group}
                  row={row}
                  unitOptions={unitOptions}
                  busy={pending === `group-${row.group}`}
                  onRoles={(roles) => saveGroup(row, { roles })}
                  onUnits={(resultUnitIds) => saveGroup(row, { resultUnitIds })}
                  // Only a row that grants something has a mapping to delete.
                  // The rest are here because people hold them, and there is
                  // nothing of ours to remove.
                  onRemove={grants(row) ? () => removeGroup(row) : undefined}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ── Roles → privileges ─────────────────────────────────── */}
      <Card>
        <CardHeader title={t("capabilitiesTitle")} subtitle={t("capabilitiesSubtitle")} />
        <CardBody>
          {/* Wide by nature (seven roles by twelve privileges) so it scrolls
              inside its own box rather than making the page scroll sideways. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-64 px-2 py-2 text-left font-medium text-muted">
                    {t("capabilityColumn")}
                  </th>
                  {ROLES.map((role) => (
                    <th key={role} className="px-2 py-2 text-center font-medium">
                      <span className="block">{tRole(role)}</span>
                      <span className="block text-xs font-normal text-muted">
                        {t("holderCount", { count: roleHolders[role] ?? 0 })}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CAPABILITIES.map((capability) => (
                  <tr key={capability} className="border-t border-border">
                    <th scope="row" className="px-2 py-2.5 text-left font-normal">
                      <span className="block font-medium">{tCap(capability)}</span>
                      <span className="block text-xs text-muted">
                        {tCap(`${capability}_hint`)}
                      </span>
                    </th>
                    {ROLES.map((role) => (
                      <td key={role} className="px-2 py-2.5 text-center">
                        <Checkbox
                          checked={ticked.has(`${role}\u0000${capability}`)}
                          onChange={() => void toggleCapability(role, capability)}
                          label={`${tCap(capability)} – ${tRole(role)}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The one thing the grid cannot say, said next to it. Somebody will
              come here looking for an attest tickbox, and its absence is a
              decision rather than an oversight. */}
          <p className="mt-4 text-xs text-muted">{t("attestNote")}</p>
        </CardBody>
      </Card>
    </div>
  );
}

function GroupEditor({
  row,
  unitOptions,
  busy,
  onRoles,
  onUnits,
  onRemove,
}: {
  row: GroupRow;
  unitOptions: { value: string; label: string }[];
  busy: boolean;
  onRoles: (roles: Role[]) => void;
  onUnits: (ids: string[]) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("admin.roles");
  const tRole = useTranslations("common.role");
  const mapped = row.roles.length > 0 || row.resultUnits.length > 0;

  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
      <div className="min-w-52 flex-1">
        <code className="font-mono text-sm">{row.group}</code>
        <p className="mt-0.5 text-xs text-muted">
          {row.holders > 0 ? t("holderCount", { count: row.holders }) : t("nobodyHolds")}
        </p>
        {/* A row that grants something to nobody is the silent failure this
            whole screen exists to end: almost always a misspelling, and
            invisible from the inside because the grant simply never fires. */}
        {mapped && row.holders === 0 && (
          <Tag tone="warning" className="mt-1.5">
            {t("probablyTypo")}
          </Tag>
        )}
      </div>

      <MultiCombobox
        values={row.roles}
        onChange={(v) => onRoles(v as Role[])}
        options={ROLES.map((r) => ({ value: r, label: tRole(r) }))}
        placeholder={t("noRoles")}
        size="sm"
        disabled={busy}
        aria-label={t("rolesFor", { group: row.group })}
        className="w-52"
      />

      <MultiCombobox
        values={row.resultUnits.map((u) => u.id)}
        onChange={onUnits}
        options={unitOptions}
        placeholder={t("noResultUnits")}
        size="sm"
        disabled={busy}
        aria-label={t("resultUnitsFor", { group: row.group })}
        className="w-56"
      />

      {onRemove && (
        <IconButton
          onClick={onRemove}
          disabled={busy}
          label={t("removeGroupLabel", { group: row.group })}
          tone="danger"
        >
          <IconTrash className="size-4" />
        </IconButton>
      )}
    </li>
  );
}
