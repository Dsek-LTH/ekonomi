"use client";

// Settings → Users, organised by role rather than by member.
//
// User.roles defaults to [ORDINARIE], so with a whole section in the table
// every one of ~1000 members holds it and it says nothing about anyone. What an
// admin actually manages is the couple of dozen people who hold something more.
// So this lists the roles and who holds each — and a member without a role
// simply never appears until you search for them.
//
// Read-only, since sign-in moved to Authentik: roles are derived from the
// Authentik group list at each sign-in (lib/server/authentik-roles.ts), so a
// role granted here would last until the holder next signed in and then quietly
// revert. The place to change one is the mandate in Authentik. What this page is for now is answering "who holds
// what, right now" — and showing when the answer is not what somebody expected,
// which is the first thing you want to know when a mapping is wrong.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/icon-button";
import { IconX } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";
import { ASSIGNABLE_ROLES } from "@/lib/domain/permissions";
import type { User } from "@/lib/domain/types";
import { PersonSearch } from "./person-search";

export function UsersClient({ holders }: { holders: User[] }) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("common.role");

  // A member looked up by the top search — shown so their whole role set is
  // visible in one place, including for someone who holds nothing more than
  // the baseline and therefore appears in no list below.
  const [inspecting, setInspecting] = useState<User | null>(null);

  // The looked-up member may have been re-synced since; prefer the live row.
  const live = inspecting
    ? holders.find((u) => u.id === inspecting.id) ?? inspecting
    : null;

  return (
    <div className="space-y-5">
      {/* Look up anyone, including the ~980 with no role at all. */}
      <Card>
        <CardHeader title={t("findTitle")} subtitle={t("findSubtitle")} />
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

              {/* Every assignable role, held or not, rather than only the held
                  ones: "does this person have attesträtt" is answered by the
                  absence as much as by the presence, and a row of four chips
                  with one lit says it at a glance. Not `Chip` — that is a
                  toggle, and there is nothing here to toggle. */}
              <div className="mt-3 flex flex-wrap gap-2">
                {ASSIGNABLE_ROLES.map((r) => (
                  <span
                    key={r}
                    className={cn(
                      "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium",
                      live.roles.includes(r)
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border text-muted",
                    )}
                  >
                    {tRole(r)}
                  </span>
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
        <CardHeader title={t("rolesTitle")} subtitle={t("rolesSubtitle", { role: tRole("ORDINARIE") })} />
        {ASSIGNABLE_ROLES.map((role) => {
          const members = holders.filter((u) => u.roles.includes(role));
          return (
            <div key={role} className="border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-4 px-inset pb-1.5 pt-4">
                <p className="text-sm font-semibold">{tRole(role)}</p>
                <span className="text-xs tabular-nums text-muted">{members.length}</span>
              </div>

              {members.length === 0 ? (
                <p className="px-inset pb-4 text-sm text-muted">{t("nobodyHasRole")}</p>
              ) : (
                <ul className="pb-2">
                  {members.map((u) => (
                    <li key={u.id} className="flex items-center gap-3.5 px-inset py-2">
                      <Avatar initials={u.initials} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.name}</p>
                        <p className="truncate text-xs text-muted">{u.email}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
