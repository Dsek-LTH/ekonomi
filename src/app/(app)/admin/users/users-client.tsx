"use client";

// Settings → Users, organised by role rather than by member.
//
// User.roles defaults to [ORDINARIE], so with a whole section in the table
// every one of ~1000 members holds it and it says nothing about anyone. What an
// admin actually manages is the couple of dozen people who hold something more.
// So this lists the roles and who holds each, and a member without a role
// simply never appears until you search for them.
//
// Read-only, since sign-in moved to Authentik: roles are derived from the
// Authentik group list at each sign-in (lib/server/authentik-roles.ts), so a
// role granted here would last until the holder next signed in and then quietly
// revert. The place to change one is the mandate in Authentik. What this page is for now is answering "who holds
// what, right now", and showing when the answer is not what somebody expected,
// which is the first thing you want to know when a mapping is wrong.
//
// Which is why the panel says why. "Who holds what" is only half of that
// question: the half that gets asked out loud is "…and how did *he* end up
// resultatansvarig", and a screen that can only answer the first half sends the
// reader to Authentik with a name and no idea which group to look for. The
// answer comes from /api/users/[id]/authority, which re-runs the sign-in
// derivation over the group list stored on the row and reports its workings,
// including the case that prompted all this: a role nothing grants any more.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/icon-button";
import { IconX } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { Tag } from "@/components/ui/status-pill";
import { cn } from "@/lib/ui/utils";
import { ASSIGNABLE_ROLES } from "@/lib/domain/permissions";
import type { UserAuthority } from "@/lib/data/authority";
import type { User } from "@/lib/domain/types";
import { PersonSearch } from "./person-search";

export function UsersClient({ holders }: { holders: User[] }) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("common.role");

  // A member looked up by the top search, shown so their whole role set is
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
                  with one lit says it at a glance. Not `Chip`, that is a
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

              {/* Keyed on the member: a fresh mount per person is what keeps
                  one person's reasons from being read under another's name
                  while the next request is still in flight. */}
              <WhyPanel key={live.id} userId={live.id} />
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
                    <li key={u.id}>
                      {/* A row is the way into the panel above. Somebody
                          reading this list found the name they did not expect
                          here. The next thing they want is why, and making
                          them retype the name into the search to get it would
                          be asking for something the screen already knows. */}
                      <button
                        type="button"
                        onClick={() => setInspecting(u)}
                        aria-label={t("explainFor", { name: u.name })}
                        className="flex w-full items-center gap-3.5 px-inset py-2 text-left transition-colors hover:bg-surface"
                      >
                        <Avatar initials={u.initials} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{u.name}</span>
                          <span className="block truncate text-xs text-muted">{u.email}</span>
                        </span>
                      </button>
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

/**
 * Where one member's roles came from.
 *
 * Fetched rather than passed down: the list above carries a thousand people's
 * worth of nothing until one of them is asked about, and the answer depends on
 * the mapping as it stands right now rather than as it stood when the page was
 * rendered.
 */
function WhyPanel({ userId }: { userId: string }) {
  const t = useTranslations("admin.users");
  const tRole = useTranslations("common.role");

  const [data, setData] = useState<UserAuthority | null>(null);
  const [failed, setFailed] = useState(false);

  // Every setState happens in the async callback rather than in the effect body,
  // the same way the person search does it: a render per mount is not a render
  // per keystroke, but the rule is worth keeping in one shape. Which is also why
  // the caller mounts this under a key. The state that would otherwise need
  // clearing here simply does not exist yet.
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/users/${userId}/authority`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        setData(await res.json());
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") setFailed(true);
      }
    })();

    return () => controller.abort();
  }, [userId]);

  if (failed) return <p className="mt-4 text-xs text-muted">{t("whyFailed")}</p>;
  if (!data) {
    return (
      <p className="mt-4 flex items-center gap-2 text-xs text-muted">
        <Spinner size="sm" />
        {t("whyLoading")}
      </p>
    );
  }

  const granted = data.roles.filter((r) => !r.baseline);

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("whyTitle")}</p>

      {/* Nothing below can be explained for someone we have never seen a group
          list for, and it matters that the screen says which of the two silences
          this is: "no group grants this role" and "we don't know their groups"
          look identical and mean opposite things. */}
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
                  {" – "}
                  {t("via")} <GroupNames groups={r.groups} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* A leftover is the case that is worth a sentence rather than a chip: it
          is not wrong data to be corrected here, it is a row waiting for its
          holder to sign in, and knowing that is what stops somebody editing the
          mapping to chase it. */}
      {granted.some((r) => r.leftover) && (
        <Notice tone="warning">{t("leftoverExplained")}</Notice>
      )}

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
                    {" – "}
                    {t("via")} <GroupNames groups={u.groups} />
                  </span>
                )}
                {/* Attest is matched on the name (lib/domain/permissions.ts), so
                    a name with no result unit behind it is authority over
                    nothing, held, and silently inert. */}
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

      {/* The mirror image of a leftover, and rarer: an edit to the mapping
          re-derives everyone it touches on the spot, so a row that is behind
          the mapping means this person's own groups changed under it. */}
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
                  "rounded-md border border-border px-2 py-0.5 font-mono text-xs",
                  // A group that grants nothing here is most of the list. The
                  // section's Authentik tree is not about this app, so it is
                  // dimmed rather than labelled. What the reader is looking for
                  // is the one that is not dim.
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

/** The group names behind one grant, as code, comma-separated. */
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
