"use client";

import { useTranslations } from "next-intl";

import { SettingsCard } from "@/components/settings/settings-card";
import { useProgressRouter } from "@/components/shell/route-progress";
import { UserAvatar } from "@/components/ui/avatar";
import { ClientDataTable, type ClientSelectFilter } from "@/components/ui/client-data-table";
import { type Column } from "@/components/ui/data-table";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls } from "@/lib/data/use-list-query";
import { ASSIGNABLE_ROLES } from "@/lib/domain/permissions";
import type { User } from "@/lib/domain/types";
import { PersonSearch } from "./person-search";

// Everybody holding a role beyond the baseline or a personal grant. A member opens on their own page
// (`/admin/users/[id]`); anybody else is found with the search.
export function UsersClient({ holders }: { holders: User[] }) {
  const t = useTranslations("admin.users");
  const tRole = useTranslations("common.role");
  const controls = useTableControls({ sortKey: "name" });
  const router = useProgressRouter();

  const held = (u: User) => ASSIGNABLE_ROLES.filter((r) => u.roles.includes(r));
  const href = (u: User) => `/admin/users/${u.id}`;

  const roleFilter: ClientSelectFilter<User> = {
    label: t("filterRole"),
    options: ASSIGNABLE_ROLES.map((r) => ({
      value: r,
      label: tRole(r),
      predicate: (u: User) => u.roles.includes(r),
    })),
  };

  const columns: Column<User>[] = [
    {
      key: "name",
      header: t("colName"),
      value: (u) => u.name,
      sortable: true,
      mobile: "title",
      cell: (u) => (
        <span className="flex min-w-0 items-center gap-3">
          <UserAvatar userId={u.id} name={u.name} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{u.name}</span>
            <span className="block truncate text-xs text-muted">{u.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: "roles",
      mobile: "meta",
      mobileCell: (u) =>
        held(u)
          .map((r) => tRole(r))
          .join(", "),
      header: t("colRoles"),
      value: (u) =>
        held(u)
          .map((r) => tRole(r))
          .join(", "),
      sortable: true,
      cell: (u) => (
        <span className="flex flex-wrap gap-1">
          {held(u).map((r) => (
            <Tag key={r} tone="accent">
              {tRole(r)}
            </Tag>
          ))}
          {u.hasPersonalGrants && <Tag tone="purple">{t("personalTag")}</Tag>}
        </span>
      ),
    },
  ];

  return (
    <SettingsCard>
      <ClientDataTable
        columns={columns}
        rows={holders}
        controls={controls}
        filter={roleFilter}
        rowKey={(u) => u.id}
        rowHref={href}
        empty={holders.length === 0 ? t("nobodyHasRole") : t("noMatch")}
        action={<PersonSearch onSelect={(u) => router.push(href(u))} className="w-full sm:w-72" />}
      />
    </SettingsCard>
  );
}
