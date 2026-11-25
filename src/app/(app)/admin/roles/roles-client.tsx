"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { SettingsCard, SettingsGroup, SettingsSection } from "@/components/settings/settings-card";
import {
  SettingsForm,
  useDraft,
  useDraftPart,
  useDraftRows,
} from "@/components/settings/settings-draft";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import { Combobox, MultiCombobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { InfoHint } from "@/components/ui/info-hint";
import { Notice } from "@/components/ui/notice";
import { SidebarItem, SidebarPanel } from "@/components/ui/sidebar-list";
import { Tag } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { useTableControls } from "@/lib/data/use-list-query";
import { CAPABILITIES, GRANTABLE_ROLES, ROLES } from "@/lib/domain/permissions";
import { isSectionGroup } from "@/lib/domain/group-name";
import type { AuthorityData, GroupRow } from "@/lib/data/authority";
import type { Capability, Role } from "@/lib/domain/types";

const MANY = 25;

const grants = (g: GroupRow) => g.roles.length > 0;

const AREA_OF: Record<Capability, Area> = {
  ADMIN: "expenses",
  ATTEST_VIEW: "expenses",
  EXPENSE_DEADLINE_WAIVE: "expenses",
  SEND_REMINDERS: "expenses",
  MEMBER_SCORE_VIEW: "expenses",
  BOOKKEEPING: "bookkeeping",
  BOOKKEEPING_VIEW: "bookkeeping",
  AUDIT_REVIEW: "bookkeeping",
  FORTNOX_LOGIN: "bookkeeping",
  EXPORT_UNDO: "bookkeeping",
  INVOICE_TRIAGE: "bookkeeping",
  REVIEW_OWN_BOOKING: "bookkeeping",
  BUDGET_VIEW: "budget",
  BUDGET_COMMENT: "budget",
  BUDGET_LOCK: "budget",
  BUDGET_CHANGE_LOCKED: "budget",
  ALCOHOL_STOCK_VIEW: "stock",
  ALCOHOL_STOCK_MANAGE: "stock",
  CAFE_STOCK_VIEW: "stock",
  CAFE_STOCK_MANAGE: "stock",
  BOARD_TAB: "stock",
  SETTINGS: "settings",
  GRANT_ACCESS: "settings",
};
const AREAS = ["expenses", "bookkeeping", "budget", "stock", "settings"] as const;
type Area = (typeof AREAS)[number];

// Two tables, so two sections of the page rather than a view toggle (docs/settings.md): what each role may do,
// and which Authentik groups give which role. A result unit's groups are set on the unit, a place's on the place.
export function RolesClient({
  groups,
  roleCapabilities,
  roleHolders,
  membersWithoutGroups,
  viewerRoles,
}: AuthorityData & { viewerRoles: Role[] }) {
  const t = useTranslations("admin.roles");

  return (
    <PageShell title={t("title")}>
      <SettingsForm>
        <div className="space-y-10">
          <SettingsSection title={t("section.roles")}>
            <CapabilitiesView
              roleCapabilities={roleCapabilities}
              roleHolders={roleHolders}
              viewerRoles={viewerRoles}
            />
          </SettingsSection>
          <SettingsSection title={t("section.groups")}>
            {membersWithoutGroups > 0 && (
              <Notice tone="info">{t("staleCounts", { count: membersWithoutGroups })}</Notice>
            )}
            <GroupsView groups={groups} />
          </SettingsSection>
        </div>
      </SettingsForm>
    </PageShell>
  );
}

function GroupsView({ groups }: Pick<AuthorityData, "groups">) {
  const t = useTranslations("admin.roles");
  const tRole = useTranslations("common.role");
  const tCommon = useTranslations("common");
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const controls = useTableControls();

  // RESULTATANSVARIG comes with a result unit and is set on the unit; ORDINARIE is everyone's.
  const roleOptions = GRANTABLE_ROLES.map((r) => ({ value: r, label: tRole(r) }));

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ group: string; roles: Role[] }>({ group: "", roles: [] });

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

  // A group's roles wait for the page's Spara. Linking a new group and removing one happen at once.
  const rows = useMemo(() => groups.map((g) => ({ ...g, id: g.group })), [groups]);
  const edits = useDraftRows(rows);
  const shown = rows.map(edits.get);

  async function saveGroup(row: GroupRow, roles: Role[]) {
    // Asked once per group, when it is first changed.
    const first = !edits.changes.some(([id]) => id === row.group);
    if (first && row.holders >= MANY) {
      const ok = await confirm({
        title: t("confirmManyTitle"),
        message: t("confirmManyBody", { group: row.group, count: row.holders }),
        confirmLabel: t("confirmManyAction"),
      });
      if (!ok) return;
    }
    edits.set(row.group, { roles });
  }

  useDraftPart({
    dirty: edits.dirty,
    save: async () => {
      let affected = 0;
      for (const [group, change] of edits.changes) {
        const data = await mutate("/api/authority/groups", {
          method: "PUT",
          body: { group, roles: change.roles },
          error: t("saveFailed"),
          refresh: false,
        });
        if (!data) return false;
        affected += (data as { affected?: number }).affected ?? 0;
      }
      if (affected > 0) notify.success(t("savedAffecting", { count: affected }));
      return true;
    },
    commit: edits.commit,
    reset: edits.reset,
  });

  function saved(data: unknown) {
    const affected = (data as { affected?: number }).affected ?? 0;
    notify.success(affected > 0 ? t("savedAffecting", { count: affected }) : t("saved"));
  }

  async function put(group: string, holders: number, roles: Role[]) {
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
      body: { group, roles },
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
    if (await put(group, holders, draft.roles)) {
      setDraft({ group: "", roles: [] });
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
          {grants(g) && g.holders === 0 && <Tag tone="warning">{t("probablyTypo")}</Tag>}
        </span>
      ),
    },
    {
      key: "holders",
      mobile: "hide",
      header: t("colHolders"),
      value: (g) => g.holders,
      sortable: true,
      align: "right",
      className: "w-24 tabular-nums",
      cell: (g) => (g.holders > 0 ? g.holders : <span className="text-muted">0</span>),
    },
    {
      key: "roles",
      mobile: "meta",
      mobileCell: (g) => g.roles.map((r) => tRole(r)).join(", "),
      header: t("colRoles"),
      value: (g) => g.roles.map((r) => tRole(r)).join(" "),
      searchable: true,
      cell: (g) => (
        <MultiCombobox
          values={g.roles}
          onChange={(v) => void saveGroup(g, v as Role[])}
          options={roleOptions}
          placeholder={t("noRoles")}
          size="sm"
          aria-label={t("rolesFor", { group: g.group })}
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
    <SettingsCard>
      <ClientDataTable
        columns={columns}
        rows={shown}
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
                options={
                  draft.group && !candidates.some((c) => c.value === draft.group)
                    ? [
                        {
                          value: draft.group,
                          label: draft.group,
                          short: draft.group,
                        },
                        ...candidates,
                      ]
                    : candidates
                }
                value={draft.group}
                onChange={(group) => setDraft({ ...draft, group })}
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
              <Button
                size="sm"
                loading={pending === `group-${draft.group}`}
                disabled={!draft.group || draft.roles.length === 0}
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
    </SettingsCard>
  );
}

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
  const [role, setRole] = useState<Role>(ROLES[0]);

  // Keys are "ROLE\0CAPABILITY": NUL because no enum member can contain one.
  const ticked = useMemo(
    () => new Set(roleCapabilities.map((r) => `${r.role}\u0000${r.capability}`)),
    [roleCapabilities],
  );
  // What each role may do, as a draft until the page's Spara. The lockout check runs then, per role.
  const base = useMemo(
    () =>
      Object.fromEntries(
        ROLES.map((r) => [r, CAPABILITIES.filter((c) => ticked.has(`${r}\u0000${c}`))]),
      ) as Record<Role, Capability[]>,
    [ticked],
  );
  const draft = useDraft(base);
  const capsOf = (role: Role) => draft.value[role];

  useDraftPart({
    dirty: draft.dirty,
    save: async () => {
      for (const [r, capabilities] of Object.entries(draft.changes)) {
        const ok = await mutate("/api/authority/capabilities", {
          method: "PUT",
          body: { role: r, capabilities },
          error: t("saveFailed"),
          refresh: false,
        });
        if (ok === null) return false;
      }
      return true;
    },
    commit: draft.commit,
    reset: draft.reset,
  });

  async function toggleCapability(role: Role, capability: Capability) {
    const on = capsOf(role).includes(capability);
    const next = on ? capsOf(role).filter((c) => c !== capability) : [...capsOf(role), capability];

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

    draft.set(role, next);
  }

  // Role first: one role's capabilities in a single column, so the screen fits a phone and keeps fitting as
  // roles are added. The roles are a column beside it from lg, and a bar opening a list below that.
  const holderLabel = (role: Role) => t("holderCount", { count: roleHolders[role] ?? 0 });

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <SidebarPanel
        bar={
          <>
            <span className="font-medium">{tRole(role)}</span>
            <span className="text-muted"> - {holderLabel(role)}</span>
          </>
        }
        sheetLabel={t("pickRole")}
      >
        {ROLES.map((r) => (
          <SidebarItem key={r} active={r === role} onClick={() => setRole(r)}>
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{tRole(r)}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {t("capabilityCount", { count: capsOf(r).length })}
              </span>
            </span>
            <span className="block text-xs text-muted">{holderLabel(r)}</span>
          </SidebarItem>
        ))}
      </SidebarPanel>

      <SettingsCard
        className="min-w-0 flex-1"
        title={tRole(role)}
        action={<span className="text-xs text-muted">{holderLabel(role)}</span>}
      >
        {AREAS.map((area) => (
          <SettingsGroup key={area} title={t(`area.${area}`)}>
            {CAPABILITIES.filter((c) => AREA_OF[c] === area).map((capability) => (
              <li
                key={capability}
                className="flex items-center gap-3 border-b border-border px-inset py-2 last:border-0"
              >
                <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                  {tCap(capability)}
                  <InfoHint label={tCap(capability)}>{tCap(`${capability}_hint`)}</InfoHint>
                </span>
                <Checkbox
                  checked={capsOf(role).includes(capability)}
                  onChange={() => void toggleCapability(role, capability)}
                  label={`${tCap(capability)} - ${tRole(role)}`}
                />
              </li>
            ))}
          </SettingsGroup>
        ))}
      </SettingsCard>
    </div>
  );
}
