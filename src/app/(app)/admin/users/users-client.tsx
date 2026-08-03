"use client";

// Settings → Users, organised by role rather than by member.
//
// User.roles defaults to [ORDINARIE], so with a whole section in the table
// every one of ~1000 members holds it and it says nothing about anyone. What an
// admin actually manages is the couple of dozen people who hold something more.
// So this lists the roles and who holds each — and a member without a role
// simply never appears until you search for them.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash, IconX } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { ASSIGNABLE_ROLES } from "@/lib/domain/permissions";
import type { Role, User } from "@/lib/domain/types";
import { PersonSearch } from "./person-search";

export function UsersClient({ holders }: { holders: User[] }) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("common.role");
  const confirm = useConfirm();
  const { pending, busy, mutate } = useMutation();

  // Which role's "+ add" picker is open.
  const [adding, setAdding] = useState<Role | null>(null);
  // A member looked up by the top search — shown so their whole role set can be
  // edited in one place, including granting the first one.
  const [inspecting, setInspecting] = useState<User | null>(null);

  // The looked-up member may have been edited since; prefer the live row.
  const live = inspecting
    ? holders.find((u) => u.id === inspecting.id) ?? inspecting
    : null;

  // `role` only names which control started this — one user's chips all write
  // the same field, so without it every chip in the row spins together.
  async function setRoles(user: User, roles: Role[], role: Role) {
    const ok = await mutate(`/api/users/${user.id}`, {
      key: `${user.id}:${role}`,
      method: "PATCH",
      body: { roles },
      error: t("saveFailed"),
    });
    // Keep the inspected card in step with what was just saved.
    if (ok && inspecting?.id === user.id) setInspecting({ ...user, roles });
  }

  function grant(user: User, role: Role) {
    if (user.roles.includes(role)) return;
    setRoles(user, [...user.roles, role], role);
  }

  async function revoke(user: User, role: Role) {
    const ok = await confirm({
      title: t("removeTitle", { role: tRole(role), name: user.name }),
      message: t("removeMessage"),
      confirmLabel: t("remove"),
      tone: "danger",
    });
    if (!ok) return;
    setRoles(user, user.roles.filter((r) => r !== role), role);
  }

  return (
    <div className="space-y-5">
      {/* Look up anyone, including the ~980 with no role at all. */}
      <Card>
        <CardHeader
          title={t("findTitle")}
          subtitle={t("findSubtitle")}
        />
        <CardBody className="space-y-4">
          <PersonSearch onSelect={setInspecting} className="max-w-md" />

          {live && (
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3.5">
                  <Avatar initials={live.initials} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{live.name}</p>
                    <p className="truncate text-xs text-muted">{live.email}</p>
                  </div>
                </div>
                <IconButton size="sm" label={tCommon("close")} onClick={() => setInspecting(null)}>
                  <IconX className="size-4" />
                </IconButton>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {ASSIGNABLE_ROLES.map((r) => (
                  <Chip
                    key={r}
                    active={live.roles.includes(r)}
                    loading={pending === `${live.id}:${r}`}
                    disabled={busy}
                    onClick={() =>
                      live.roles.includes(r) ? revoke(live, r) : grant(live, r)
                    }
                  >
                    {tRole(r)}
                  </Chip>
                ))}
              </div>
              {!live.roles.some((r) => r !== "ORDINARIE") && (
                <p className="mt-2 text-xs text-muted">
                  {t("onlyBaseRole", { role: tRole("ORDINARIE") })}
                </p>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* One section per role. ORDINARIE is left out: everyone holds it. */}
      <Card>
        <CardHeader
          title={t("rolesTitle")}
          subtitle={t("rolesSubtitle", { role: tRole("ORDINARIE") })}
        />
        {ASSIGNABLE_ROLES.map((role) => {
          const members = holders.filter((u) => u.roles.includes(role));
          return (
            <div key={role} className="border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-4 px-inset pb-1.5 pt-4">
                <p className="text-sm font-semibold">{tRole(role)}</p>
                <span className="text-xs tabular-nums text-muted">{members.length}</span>
              </div>

              {members.length === 0 ? (
                <p className="px-inset pb-2 text-sm text-muted">{t("nobodyHasRole")}</p>
              ) : (
                <ul className="pb-1">
                  {members.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center gap-3.5 px-inset py-2 transition-colors hover:bg-surface/50"
                    >
                      <Avatar initials={u.initials} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.name}</p>
                        <p className="truncate text-xs text-muted">{u.email}</p>
                      </div>
                      <IconButton
                        tone="danger"
                        onClick={() => revoke(u, role)}
                        loading={pending === `${u.id}:${role}`}
                        label={t("removeAria", { role: tRole(role), name: u.name })}
                      >
                        <IconTrash className="size-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}

              <div className="px-inset pb-4 pt-1">
                {adding === role ? (
                  <div className="flex items-start gap-2">
                    <PersonSearch
                      autoFocus
                      className="max-w-sm flex-1"
                      placeholder={t("addPlaceholder", { role: tRole(role).toLowerCase() })}
                      exclude={members.map((u) => u.id)}
                      onSelect={(u) => {
                        grant(u, role);
                        setAdding(null);
                      }}
                    />
                    <IconButton label={tCommon("cancel")} onClick={() => setAdding(null)}>
                      <IconX className="size-4" />
                    </IconButton>
                  </div>
                ) : (
                  <button
                    onClick={() => setAdding(role)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted transition hover:bg-surface hover:text-foreground"
                  >
                    <IconPlus className="size-4" />
                    {t("addPerson")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
