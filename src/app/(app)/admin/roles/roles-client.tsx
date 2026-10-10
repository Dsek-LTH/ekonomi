"use client";

// Settings → Roles. The two halves of authority, as two views of one screen
// because they are one question read from either end.
//
//   Grupper       which Authentik group makes you what here
//   Behörigheter  what each of those roles may then do
//
// Everything else in the app derives from these two tables: a sign-in runs the
// first (lib/server/authentik-roles.ts) and every gate reads the second
// (lib/server/capabilities.ts). They used to be two cards stacked on one page,
// a list of every group in the section above a grid wider than the overlay,
// and neither could be read without scrolling past the other.
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
import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import { Combobox, MultiCombobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { InfoHint } from "@/components/ui/info-hint";
import { Notice } from "@/components/ui/notice";
import { Tag } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { useTableControls } from "@/lib/data/use-list-query";
import { CAPABILITIES, ROLES } from "@/lib/domain/permissions";
import { isSectionGroup } from "@/lib/domain/group-name";
import type { AuthorityData, GroupRow } from "@/lib/data/authority";
import type { Capability, Role } from "@/lib/domain/types";

/** How many people a change has to reach before it is worth stopping over. */
const MANY = 25;

/** Whether a row confers anything at all. */
const grants = (g: GroupRow) => g.roles.length > 0 || g.resultUnits.length > 0;

/**
 * Which part of the app each capability is about, so the grid reads as six
 * short blocks rather than eighteen rows in a list. A Record over the whole
 * union, so a capability added later is a compile error here until it is
 * given a heading, rather than a row the grid quietly leaves out.
 */
const AREA_OF: Record<Capability, Area> = {
  ADMIN: "expenses",
  ATTEST_VIEW: "expenses",
  EXPENSE_DEADLINE_WAIVE: "expenses",
  BOOKKEEPING: "bookkeeping",
  FORTNOX_LOGIN: "bookkeeping",
  EXPORT_UNDO: "bookkeeping",
  BUDGET_VIEW: "budget",
  BUDGET_COMMENT: "budget",
  BUDGET_LOCK: "budget",
  BUDGET_CHANGE_LOCKED: "budget",
  STOCK_VIEW: "stock",
  STOCK_MANAGE: "stock",
  CONTRACT_VIEW: "contracts",
  CONTRACT_MANAGE: "contracts",
  RENTAL_VIEW: "contracts",
  RENTAL_MANAGE: "contracts",
  FIRMATECKNARE: "contracts",
  SETTINGS: "settings",
};
const AREAS = ["expenses", "bookkeeping", "budget", "stock", "contracts", "settings"] as const;
type Area = (typeof AREAS)[number];

type View = "groups" | "capabilities";

export function RolesClient({
  groups,
  resultUnits,
  roleCapabilities,
  roleHolders,
  membersWithoutGroups,
  viewerRoles,
}: AuthorityData & { viewerRoles: Role[] }) {
  const t = useTranslations("admin.roles");
  const [view, setView] = useState<View>("groups");

  return (
    <PageShell
      title={t("title")}
      // Two views of the same authority, so the header's own switch, the
      // way Mina / Alla is elsewhere.
      collections={{
        label: t("viewLabel"),
        value: view,
        options: [
          { value: "groups", label: t("view.groups") },
          { value: "capabilities", label: t("view.capabilities") },
        ],
        onChange: (v) => setView(v as View),
      }}
    >
      {/* The counts on this screen are counts of people we have seen. Somebody
          who has not signed in since their group list started being kept is in
          none of them, and a number that quietly excluded a third of the
          section would be worse than no number. */}
      {membersWithoutGroups > 0 && (
        <Notice tone="info">{t("staleCounts", { count: membersWithoutGroups })}</Notice>
      )}

      {view === "groups" ? (
        <GroupsView groups={groups} resultUnits={resultUnits} />
      ) : (
        <CapabilitiesView
          roleCapabilities={roleCapabilities}
          roleHolders={roleHolders}
          viewerRoles={viewerRoles}
        />
      )}
    </PageShell>
  );
}

// ── Grupper ───────────────────────────────────────────────────────

function GroupsView({
  groups,
  resultUnits,
}: Pick<AuthorityData, "groups" | "resultUnits">) {
  const t = useTranslations("admin.roles");
  const tRole = useTranslations("common.role");
  const tCommon = useTranslations("common");
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const controls = useTableControls();

  const unitOptions = useMemo(
    () => resultUnits.map((u) => ({ value: u.id, label: u.name })),
    [resultUnits],
  );
  const roleOptions = ROLES.map((r) => ({ value: r, label: tRole(r) }));

  // The new link, built up in the panel under the toolbar and saved in one go,
  // so a group is never on the list granting nothing in between.
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ group: string; roles: Role[]; unitIds: string[] }>({
    group: "",
    roles: [],
    unitIds: [],
  });

  // What to pick from: the groups people actually sit in that grant nothing
  // yet, biggest first. Picking rather than typing is what keeps a misspelt
  // group, which grants nothing and says nothing while it does, off the list.
  const candidates = useMemo(
    () =>
      groups
        .filter((g) => !grants(g))
        .sort((a, b) => b.holders - a.holders)
        .map((g) => ({
          value: g.group,
          label: `${g.group} (${t("holderCount", { count: g.holders })})`,
          short: g.group,
        })),
    [groups, t],
  );

  // The tabs open on what this screen is for, the groups that grant something.
  // Every group anyone holds is the second tab: most of them mean nothing here
  // and are meant not to. A grant that reaches nobody gets a tab of its own,
  // since it is almost always a misspelling and the one slice worth hunting.
  const mapped = groups.filter(grants);
  const tabs: ClientTabFilter<GroupRow> = [
    { value: "mapped", label: t("filter.mapped"), badge: mapped.length, predicate: grants },
    {
      value: "silent",
      label: t("filter.silent"),
      badge: mapped.filter((g) => g.holders === 0).length,
      predicate: (g) => grants(g) && g.holders === 0,
    },
    { value: "all", label: t("filter.all"), badge: groups.length },
  ];

  async function saveGroup(row: GroupRow, next: { roles?: Role[]; resultUnitIds?: string[] }) {
    const roles = next.roles ?? row.roles;
    const resultUnitIds = next.resultUnitIds ?? row.resultUnits.map((u) => u.id);
    await put(row.group, row.holders, roles, resultUnitIds);
  }

  // Both writes answer with how many people's roles they re-derived, which is
  // worth saying: it is what makes a grant you just saved real.
  function saved(data: unknown) {
    const affected = (data as { affected?: number }).affected ?? 0;
    notify.success(affected > 0 ? t("savedAffecting", { count: affected }) : t("saved"));
  }

  async function put(group: string, holders: number, roles: Role[], resultUnitIds: string[]) {
    if (holders >= MANY) {
      const ok = await confirm({
        title: t("confirmManyTitle"),
        message: t("confirmManyBody", { group, count: holders }),
        confirmLabel: t("confirmManyAction"),
      });
      if (!ok) return false;
    }
    const data = await mutate("/api/authority/groups", {
      key: `group-${group}`,
      method: "PUT",
      body: { group, roles, resultUnitIds },
      error: t("saveFailed"),
    });
    if (!data) return false;
    saved(data);
    return true;
  }

  async function link() {
    const group = draft.group.trim().toLowerCase();
    if (!group) return;
    if (!isSectionGroup(group)) {
      notify.error(t("outsideSection", { group }));
      return;
    }
    if (mapped.some((g) => g.group === group)) {
      notify.error(t("groupExists", { group }));
      return;
    }
    const holders = groups.find((g) => g.group === group)?.holders ?? 0;
    if (await put(group, holders, draft.roles, draft.unitIds)) {
      setDraft({ group: "", roles: [], unitIds: [] });
      setAdding(false);
    }
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
    saved(data);
  }

  const columns: Column<GroupRow>[] = [
    {
      key: "group",
      header: t("colGroup"),
      value: (g) => g.group,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (g) => (
        <span className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-sm">{g.group}</code>
          {/* A row that grants something to nobody is the silent failure this
              screen exists to end: almost always a misspelling, and invisible
              from the inside because the grant simply never fires. */}
          {grants(g) && g.holders === 0 && <Tag tone="warning">{t("probablyTypo")}</Tag>}
        </span>
      ),
    },
    {
      key: "holders",
      header: t("colHolders"),
      value: (g) => g.holders,
      sortable: true,
      align: "right",
      className: "w-24 tabular-nums",
      cell: (g) => (g.holders > 0 ? g.holders : <span className="text-muted">0</span>),
    },
    {
      key: "roles",
      header: t("colRoles"),
      // Searchable by what it grants as well as by name: "who is Kassör" is
      // the same question from the other end, and the group answering it is
      // the one thing the reader does not know.
      value: (g) => g.roles.map((r) => tRole(r)).join(" "),
      searchable: true,
      cell: (g) => (
        <MultiCombobox
          values={g.roles}
          onChange={(v) => saveGroup(g, { roles: v as Role[] })}
          options={roleOptions}
          placeholder={t("noRoles")}
          size="sm"
          disabled={pending === `group-${g.group}`}
          aria-label={t("rolesFor", { group: g.group })}
          className="w-full sm:w-52"
        />
      ),
    },
    {
      key: "units",
      header: t("colResultUnits"),
      value: (g) => g.resultUnits.map((u) => u.name).join(" "),
      searchable: true,
      cell: (g) => (
        <MultiCombobox
          values={g.resultUnits.map((u) => u.id)}
          onChange={(ids) => saveGroup(g, { resultUnitIds: ids })}
          options={unitOptions}
          placeholder={t("noResultUnits")}
          size="sm"
          disabled={pending === `group-${g.group}`}
          aria-label={t("resultUnitsFor", { group: g.group })}
          className="w-full sm:w-52"
        />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      className: "w-14",
      // Only a row that grants something has a mapping to delete. The rest are
      // here because people hold them, and there is nothing of ours to remove.
      cell: (g) =>
        grants(g) && (
          <IconButton
            onClick={() => removeGroup(g)}
            disabled={pending === `group-${g.group}`}
            label={t("removeGroupLabel", { group: g.group })}
            tone="danger"
          >
            <IconTrash className="size-4" />
          </IconButton>
        ),
    },
  ];

  return (
    <Card>
      <ClientDataTable
        columns={columns}
        rows={groups}
        controls={controls}
        tabs={tabs}
        searchPlaceholder={t("searchPlaceholder")}
        rowKey={(g) => g.group}
        empty={groups.length === 0 ? t("noGroups") : t("noMatches")}
        action={
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <IconPlus className="size-4" />
              {t("addGroup")}
            </Button>
          )
        }
        actionPanel={
          adding && (
            <div className="flex flex-wrap items-center gap-2">
              <Combobox
                size="sm"
                className="w-full sm:w-72"
                // A typed name is not among the candidates, so it is added for
                // the picker to show it as chosen.
                options={
                  draft.group && !candidates.some((c) => c.value === draft.group)
                    ? [{ value: draft.group, label: draft.group, short: draft.group }, ...candidates]
                    : candidates
                }
                value={draft.group}
                onChange={(group) => setDraft({ ...draft, group })}
                // A group nobody has signed in with yet is not in the list, so
                // its name can still be typed. That is the case a typo hides
                // in, so it is the exception rather than the way in.
                onCreate={(group) => setDraft({ ...draft, group: group.trim().toLowerCase() })}
                createLabel={(text) => t("useGroup", { group: text })}
                placeholder={t("pickGroup")}
                searchPlaceholder={t("searchGroups")}
                aria-label={t("addGroupLabel")}
              />
              <MultiCombobox
                values={draft.roles}
                onChange={(v) => setDraft({ ...draft, roles: v as Role[] })}
                options={roleOptions}
                placeholder={t("noRoles")}
                size="sm"
                aria-label={t("colRoles")}
                className="w-full sm:w-48"
              />
              <MultiCombobox
                values={draft.unitIds}
                onChange={(unitIds) => setDraft({ ...draft, unitIds })}
                options={unitOptions}
                placeholder={t("noResultUnits")}
                size="sm"
                aria-label={t("colResultUnits")}
                className="w-full sm:w-48"
              />
              <Button
                size="sm"
                loading={pending === `group-${draft.group}`}
                disabled={!draft.group || (draft.roles.length === 0 && draft.unitIds.length === 0)}
                onClick={link}
              >
                {t("link")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                {tCommon("cancel")}
              </Button>
            </div>
          )
        }
      />
    </Card>
  );
}

// ── Behörigheter ──────────────────────────────────────────────────

function CapabilitiesView({
  roleCapabilities,
  roleHolders,
  viewerRoles,
}: Pick<AuthorityData, "roleCapabilities" | "roleHolders"> & { viewerRoles: Role[] }) {
  const t = useTranslations("admin.roles");
  const tRole = useTranslations("common.role");
  const tCap = useTranslations("common.capability");
  const confirm = useConfirm();
  const { mutate } = useMutation();

  // The grid as a set of "ROLE\0CAPABILITY" keys, one membership test per box.
  // NUL rather than a space because no member of either enum can contain one.
  const ticked = useMemo(
    () => new Set(roleCapabilities.map((r) => `${r.role}\u0000${r.capability}`)),
    [roleCapabilities],
  );
  const capsOf = (role: Role) => CAPABILITIES.filter((c) => ticked.has(`${role}\u0000${c}`));

  async function toggleCapability(role: Role, capability: Capability) {
    const on = ticked.has(`${role}\u0000${capability}`);
    const next = on ? capsOf(role).filter((c) => c !== capability) : [...capsOf(role), capability];

    // Two questions worth stopping for, and no others.
    const holders = roleHolders[role] ?? 0;
    if (!on && holders >= MANY) {
      const ok = await confirm({
        title: t("confirmWideTitle"),
        message: t("confirmWideBody", { capability: tCap(capability), role: tRole(role), count: holders }),
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

  return (
    <Card>
      <p className="border-b border-border px-inset py-3 text-sm text-muted">
        {t("capabilitiesSubtitle")}
      </p>
      {/* Wide by nature (eight roles across) so it scrolls inside its own box,
          with the capability column held still so a tick is never read
          against a row that has scrolled out of sight. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 w-56 bg-background px-inset py-2 text-left font-medium text-muted">
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
            {AREAS.map((area) => (
              <Fragment key={area}>
                <tr className="border-b border-border bg-surface">
                  <th
                    colSpan={ROLES.length + 1}
                    scope="colgroup"
                    className="sticky left-0 px-inset py-1.5 text-left text-xs font-semibold text-muted"
                  >
                    {t(`area.${area}`)}
                  </th>
                </tr>
                {CAPABILITIES.filter((c) => AREA_OF[c] === area).map((capability) => (
                  <tr key={capability} className="border-b border-border last:border-0">
                    {/* One line per capability: the explanation is a tap away
                        rather than a second line under every row. */}
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-background px-inset py-2 text-left font-medium"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {tCap(capability)}
                        <InfoHint label={tCap(capability)}>{tCap(`${capability}_hint`)}</InfoHint>
                      </span>
                    </th>
                    {ROLES.map((role) => (
                      <td key={role} className="px-2 py-2 text-center">
                        <Checkbox
                          checked={ticked.has(`${role}\u0000${capability}`)}
                          onChange={() => void toggleCapability(role, capability)}
                          label={`${tCap(capability)} – ${tRole(role)}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {/* The one thing the grid cannot say, said next to it. Somebody will
          come here looking for an attest tickbox, and its absence is a
          decision rather than an oversight. */}
      <p className="border-t border-border px-inset py-3 text-xs text-muted">{t("attestNote")}</p>
    </Card>
  );
}
