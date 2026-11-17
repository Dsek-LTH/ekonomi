"use client";

// One member under Inställningar → Användare: what they hold and why, their personal grants, their payout account
// and the mail sent to them. A page in the overlay, not a dialog (docs/settings.md).
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useQuery } from "@/components/shell/use-query";
import {
  SettingRow,
  SettingsCard,
  SettingsGroup,
  SettingsRows,
  SettingsStack,
} from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput, Field, FieldGroup } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { Tag } from "@/components/ui/status-pill";
import type { GrantRow, UserAuthority } from "@/lib/data/authority";
import { CAPABILITIES, GRANTABLE_ROLES } from "@/lib/domain/permissions";
import type { Capability, Role } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";
import { EmailLog } from "../../email/email-log";

export function PersonClient({
  authority,
  canGrant,
  canSettings,
  canSeePayout,
}: {
  authority: UserAuthority;
  /** May give and take away personal grants (GRANT_ACCESS). */
  canGrant: boolean;
  /** Holds SETTINGS: sees the mail sent to them. */
  canSettings: boolean;
  /** Books (BOOKKEEPING): sees their payout account. */
  canSeePayout: boolean;
}) {
  const person = authority.user;
  return (
    <SettingsStack>
      <RolesCard data={authority} />
      {(canGrant || authority.grants.length > 0) && (
        <GrantsCard userId={person.id} grants={authority.grants} canGrant={canGrant} />
      )}
      {canSeePayout && <PayoutCard userId={person.id} />}
      {canSettings && <EmailCard recipient={{ id: person.id, name: person.name }} />}
    </SettingsStack>
  );
}

/** What their groups give them, and where each part comes from. */
function RolesCard({ data }: { data: UserAuthority }) {
  const t = useTranslations("admin.users");
  const tRole = useTranslations("common.role");
  const roles = data.roles.filter((r) => !r.baseline);
  const pending = [...data.pendingRoles.map((r) => tRole(r)), ...data.pendingUnits];

  return (
    <SettingsCard title={t("whyTitle")}>
      {(data.neverSeen || roles.some((r) => r.leftover) || pending.length > 0) && (
        <div className="space-y-2 border-b border-border px-inset py-3">
          {data.neverSeen && <Notice tone="info">{t("neverSeen")}</Notice>}
          {roles.some((r) => r.leftover) && (
            <Notice tone="warning">{t("leftoverExplained")}</Notice>
          )}
          {pending.length > 0 && (
            <Notice tone="info">{t("pending", { items: pending.join(", ") })}</Notice>
          )}
        </div>
      )}

      {roles.length === 0 ? (
        <p className="border-b border-border px-inset py-3 text-sm text-muted">
          {t("onlyBaseRole", { role: tRole("ORDINARIE") })}
        </p>
      ) : (
        <SettingsGroup title={t("rolesTitle")}>
          {roles.map((r) => (
            <SettingRow
              key={r.role}
              label={tRole(r.role)}
              hint={r.leftover ? undefined : <Via groups={r.groups} />}
            >
              {r.leftover && <Tag tone="warning">{t("leftover")}</Tag>}
            </SettingRow>
          ))}
        </SettingsGroup>
      )}

      {data.resultUnits.length > 0 && (
        <SettingsGroup title={t("resultUnitsTitle")}>
          {data.resultUnits.map((u) => (
            <SettingRow
              key={u.unit}
              label={u.unit}
              hint={u.leftover ? undefined : <Via groups={u.groups} />}
            >
              {(u.leftover || !u.exists) && (
                <span className="flex flex-wrap gap-1.5">
                  {u.leftover && <Tag tone="warning">{t("leftover")}</Tag>}
                  {!u.exists && <Tag tone="warning">{t("unitMissing")}</Tag>}
                </span>
              )}
            </SettingRow>
          ))}
        </SettingsGroup>
      )}

      {data.groups.length > 0 && (
        <SettingsGroup title={t("groupsTitle")}>
          <li className="px-inset py-3">
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
          </li>
        </SettingsGroup>
      )}
    </SettingsCard>
  );
}

function Via({ groups }: { groups: string[] }) {
  const t = useTranslations("admin.users");
  return (
    <>
      {t("via")}{" "}
      {groups.map((g, i) => (
        <span key={g}>
          {i > 0 && ", "}
          <code className="font-mono text-xs text-foreground">{g}</code>
        </span>
      ))}
    </>
  );
}

type GrantKind = "role" | "capability";

/** Personal grants: what this member holds on top of their groups, and the form to give more. */
function GrantsCard({
  userId,
  grants,
  canGrant,
}: {
  userId: string;
  grants: GrantRow[];
  canGrant: boolean;
}) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("common.role");
  const tCap = useTranslations("common.capability");
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<GrantKind>("role");
  const [what, setWhat] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");

  const options =
    kind === "role"
      ? GRANTABLE_ROLES.map((r) => ({ value: r, label: tRole(r) }))
      : CAPABILITIES.map((c) => ({ value: c, label: tCap(c) }));

  const label = (g: GrantRow) => (g.role ? tRole(g.role) : tCap(g.capability as Capability));

  function reset() {
    setAdding(false);
    setKind("role");
    setWhat("");
    setFrom("");
    setUntil("");
  }

  async function give() {
    const done = await mutate("/api/access-grants", {
      key: "grant-new",
      body: {
        userId,
        role: kind === "role" ? (what as Role) : null,
        capability: kind === "capability" ? (what as Capability) : null,
        from: from || null,
        until: until || null,
      },
      error: t("grantFailed"),
      success: t("granted"),
    });
    if (done) reset();
  }

  async function remove(g: GrantRow) {
    const ok = await confirm({
      title: t("removeGrantTitle"),
      message: t("removeGrantBody", { what: label(g) }),
      confirmLabel: t("removeGrantAction"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/access-grants/${g.id}`, {
      key: `grant-${g.id}`,
      method: "DELETE",
      error: t("grantFailed"),
    });
  }

  const period = (g: GrantRow) =>
    g.scheduled
      ? g.until
        ? t("grantFromUntil", { from: g.from, until: g.until })
        : t("grantFrom", { from: g.from })
      : g.until
        ? t("grantUntil", { until: g.until })
        : t("grantForever");

  return (
    <SettingsCard
      title={t("grantsTitle")}
      action={
        canGrant &&
        !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <IconPlus className="size-4" />
            {t("grantAdd")}
          </Button>
        )
      }
    >
      {grants.length === 0 && !adding && (
        <p className="px-inset py-3 text-sm text-muted">{t("noGrants")}</p>
      )}

      {grants.length > 0 && (
        <SettingsRows>
          {grants.map((g) => (
            <SettingRow
              key={g.id}
              label={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {label(g)}
                  {g.scheduled && <Tag tone="blue">{t("grantScheduled")}</Tag>}
                </span>
              }
              hint={[period(g), g.grantedBy && t("grantedBy", { name: g.grantedBy })]
                .filter(Boolean)
                .join(" - ")}
            >
              {canGrant && (
                <div className="flex justify-end">
                  <IconButton
                    label={t("removeGrantLabel", { what: label(g) })}
                    tone="danger"
                    loading={pending === `grant-${g.id}`}
                    onClick={() => remove(g)}
                  >
                    <IconTrash className="size-4" />
                  </IconButton>
                </div>
              )}
            </SettingRow>
          ))}
        </SettingsRows>
      )}

      {adding && (
        <div className="space-y-3 border-t border-border bg-surface px-inset py-4">
          <FieldGroup label={t("grantKind")}>
            <SegmentedControl<GrantKind>
              size="sm"
              value={kind}
              onChange={(k) => {
                setKind(k);
                setWhat("");
              }}
              options={[
                { value: "role", label: t("grantKindRole") },
                { value: "capability", label: t("grantKindCapability") },
              ]}
            />
          </FieldGroup>
          <FieldGroup label={kind === "role" ? t("grantKindRole") : t("grantKindCapability")}>
            <Combobox
              size="sm"
              className="w-full"
              value={what}
              onChange={setWhat}
              options={options}
              placeholder={kind === "role" ? t("grantPickRole") : t("grantPickCapability")}
              aria-label={kind === "role" ? t("grantKindRole") : t("grantKindCapability")}
            />
          </FieldGroup>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("grantFromLabel")} hint={t("grantFromHint")}>
              <DateInput size="sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t("grantUntilLabel")} hint={t("grantUntilHint")}>
              <DateInput size="sm" value={until} onChange={(e) => setUntil(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={reset}>
              {tCommon("cancel")}
            </Button>
            <Button
              size="sm"
              loading={pending === "grant-new"}
              disabled={
                !what ||
                (from !== "" && from.length !== 10) ||
                (until !== "" && until.length !== 10)
              }
              onClick={give}
            >
              {t("grantSave")}
            </Button>
          </div>
        </div>
      )}
    </SettingsCard>
  );
}

function PayoutCard({ userId }: { userId: string }) {
  const t = useTranslations("admin.users");
  const { data, error } = useQuery<{ clearing: string; account: string }>(
    `/api/users/${userId}/payout`,
  );

  return (
    <SettingsCard title={t("payoutTitle")}>
      {error && <p className="px-inset py-3 text-sm text-muted">{t("payoutFailed")}</p>}
      {!error && !data && (
        <p className="flex items-center gap-2 px-inset py-3 text-sm text-muted">
          <Spinner size="sm" />
          {t("payoutLoading")}
        </p>
      )}
      {data &&
        (!data.clearing || !data.account ? (
          <p className="px-inset py-3 text-sm text-muted">{t("payoutMissing")}</p>
        ) : (
          <SettingsRows>
            <SettingRow label={t("payoutClearing")}>
              <span className="select-all text-sm font-medium tabular-nums">{data.clearing}</span>
            </SettingRow>
            <SettingRow label={t("payoutAccount")}>
              <span className="select-all text-sm font-medium tabular-nums">{data.account}</span>
            </SettingRow>
          </SettingsRows>
        ))}
    </SettingsCard>
  );
}

function EmailCard({ recipient }: { recipient: { id: string; name: string } }) {
  const t = useTranslations("admin.users");
  return (
    <SettingsCard title={t("emailTitle")}>
      <div className="px-inset py-4">
        <EmailLog recipient={recipient} />
      </div>
    </SettingsCard>
  );
}
