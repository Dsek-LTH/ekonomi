"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/avatar";
import { ClientDataTable, type ClientSelectFilter } from "@/components/ui/client-data-table";
import { type Column } from "@/components/ui/data-table";
import { IconButton } from "@/components/ui/icon-button";
import { IconX } from "@/components/ui/icons";
import { Modal, ModalBody } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { Tag } from "@/components/ui/status-pill";
import { cn } from "@/lib/ui/utils";
import { ASSIGNABLE_ROLES, canBookkeep } from "@/lib/domain/permissions";
import { useRole } from "@/components/shell/role-context";
import { useTableControls } from "@/lib/data/use-list-query";
import type { UserAuthority } from "@/lib/data/authority";
import type { User } from "@/lib/domain/types";
import { useQuery } from "@/components/shell/use-query";
import { PersonSearch } from "./person-search";
import { EmailLog } from "../email/email-log";

export function UsersClient({ holders }: { holders: User[] }) {
  const t = useTranslations("admin.users");
  const tRole = useTranslations("common.role");
  const controls = useTableControls({ sortKey: "name" });

  const [inspecting, setInspecting] = useState<User | null>(null);
  const live = inspecting ? (holders.find((u) => u.id === inspecting.id) ?? inspecting) : null;

  const held = (u: User) => ASSIGNABLE_ROLES.filter((r) => u.roles.includes(r));

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
        <button
          type="button"
          onClick={() => setInspecting(u)}
          aria-label={t("explainFor", { name: u.name })}
          className="group flex min-w-0 items-center gap-3 text-left"
        >
          <UserAvatar userId={u.id} name={u.name} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium group-hover:text-link group-hover:underline">
              {u.name}
            </span>
            <span className="block truncate text-xs text-muted">{u.email}</span>
          </span>
        </button>
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
        </span>
      ),
    },
  ];

  return (
    <>
      <Card>
        <ClientDataTable
          columns={columns}
          rows={holders}
          controls={controls}
          filter={roleFilter}
          rowKey={(u) => u.id}
          empty={holders.length === 0 ? t("nobodyHasRole") : t("noMatch")}
          action={<PersonSearch onSelect={setInspecting} className="w-full sm:w-72" />}
        />
        <p className="border-t border-border px-inset py-3 text-xs text-muted">
          {t("rolesSubtitle", { role: tRole("ORDINARIE") })}
        </p>
      </Card>

      {live && <PersonDialog key={live.id} person={live} onClose={() => setInspecting(null)} />}
    </>
  );
}

function PersonDialog({ person, onClose }: { person: User; onClose: () => void }) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("common.role");
  const { user } = useRole();

  return (
    <Modal label={person.name} onClose={onClose} className="max-w-xl">
      <div className="flex shrink-0 items-center gap-3.5 border-b border-border px-inset py-3">
        <UserAvatar userId={person.id} name={person.name} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{person.name}</h2>
          <p className="truncate text-xs text-muted">{person.email}</p>
        </div>
        <IconButton label={tCommon("close")} onClick={onClose}>
          <IconX className="size-4" />
        </IconButton>
      </div>

      <ModalBody>
        <div>
          <div className="flex flex-wrap gap-2">
            {ASSIGNABLE_ROLES.map((r) => (
              <span
                key={r}
                className={cn(
                  "inline-flex h-7 items-center rounded-control border px-3 text-xs font-medium",
                  person.roles.includes(r)
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-muted",
                )}
              >
                {tRole(r)}
              </span>
            ))}
          </div>
          {!person.roles.some((r) => r !== "ORDINARIE") && (
            <p className="mt-2 text-xs text-muted">
              {t("onlyBaseRole", { role: tRole("ORDINARIE") })}
            </p>
          )}
        </div>

        <WhyPanel userId={person.id} />

        {canBookkeep(user.capabilities) && <PayoutPanel userId={person.id} />}

        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">{t("emailTitle")}</h3>
          <EmailLog recipient={{ id: person.id, name: person.name }} />
        </div>
      </ModalBody>
    </Modal>
  );
}

function WhyPanel({ userId }: { userId: string }) {
  const t = useTranslations("admin.users");
  const tRole = useTranslations("common.role");

  const { data, error } = useQuery<UserAuthority>(`/api/users/${userId}/authority`);

  if (error) return <p className="text-xs text-muted">{t("whyFailed")}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Spinner size="sm" />
        {t("whyLoading")}
      </p>
    );
  }

  const granted = data.roles.filter((r) => !r.baseline);

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">{t("whyTitle")}</h3>

      {data.neverSeen && <Notice tone="info">{t("neverSeen")}</Notice>}

      {granted.length === 0 ? (
        <p className="text-sm text-muted">{t("noGrantedRoles")}</p>
      ) : (
        <ul className="space-y-1.5">
          {granted.map((r) => (
            <li key={r.role} className="text-sm">
              <span className="font-medium">{tRole(r.role)}</span>
              {r.leftover ? (
                <span className="ml-2 inline-flex items-center gap-2 align-middle">
                  <Tag tone="warning">{t("leftover")}</Tag>
                </span>
              ) : (
                <span className="text-muted">
                  {" - "}
                  {t("via")} <GroupNames groups={r.groups} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {granted.some((r) => r.leftover) && <Notice tone="warning">{t("leftoverExplained")}</Notice>}

      {data.resultUnits.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted">{t("resultUnitsTitle")}</p>
          <ul className="space-y-1.5">
            {data.resultUnits.map((u) => (
              <li key={u.unit} className="text-sm">
                <span className="font-medium">{u.unit}</span>
                {u.leftover ? (
                  <span className="ml-2 align-middle">
                    <Tag tone="warning">{t("leftover")}</Tag>
                  </span>
                ) : (
                  <span className="text-muted">
                    {" - "}
                    {t("via")} <GroupNames groups={u.groups} />
                  </span>
                )}
                {!u.exists && (
                  <span className="ml-2 align-middle">
                    <Tag tone="warning">{t("unitMissing")}</Tag>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(data.pendingRoles.length > 0 || data.pendingUnits.length > 0) && (
        <Notice tone="info">
          {t("pending", {
            items: [...data.pendingRoles.map((r) => tRole(r)), ...data.pendingUnits].join(", "),
          })}
        </Notice>
      )}

      {data.groups.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted">{t("groupsTitle")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {data.groups.map((g) => (
              <li
                key={g}
                className={cn(
                  "rounded-control border border-border px-2 py-0.5 font-mono text-xs",
                  data.silentGroups.includes(g) ? "text-muted" : "text-foreground",
                )}
              >
                {g}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{t("groupsHint")}</p>
        </div>
      )}
    </div>
  );
}

function PayoutPanel({ userId }: { userId: string }) {
  const t = useTranslations("admin.users");
  const { data, error } = useQuery<{ clearing: string; account: string }>(
    `/api/users/${userId}/payout`,
  );

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">{t("payoutTitle")}</h3>
      {error && <p className="text-xs text-muted">{t("payoutFailed")}</p>}
      {!error && !data && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Spinner size="sm" />
          {t("payoutLoading")}
        </p>
      )}
      {data &&
        (!data.clearing || !data.account ? (
          <p className="text-sm text-muted">{t("payoutMissing")}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div>
              <dt className="text-[13px] text-muted">{t("payoutClearing")}</dt>
              <dd className="select-all text-sm font-medium tabular-nums">{data.clearing}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted">{t("payoutAccount")}</dt>
              <dd className="select-all text-sm font-medium tabular-nums">{data.account}</dd>
            </div>
          </dl>
        ))}
    </div>
  );
}

function GroupNames({ groups }: { groups: string[] }) {
  return (
    <>
      {groups.map((g, i) => (
        <span key={g}>
          {i > 0 && ", "}
          <code className="font-mono text-xs text-foreground">{g}</code>
        </span>
      ))}
    </>
  );
}
