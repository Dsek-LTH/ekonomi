"use client";

// Settings → Users. One table of the people who hold a role, filterable by
// role, and a search over the whole section for anyone else. A person opens
// in a dialog over the table, wherever their row was.
//
// User.roles defaults to [ORDINARIE], so with a whole section in the table
// every one of ~1000 members holds it and it says nothing about anyone. What an
// admin actually manages is the couple of dozen people who hold something more.
// So the table is those, and a member without a role simply never appears until
// you search for them.
//
// It was a search card with the person opening inside it, above a card with a
// section per role listing its holders. Somebody near the bottom of that list
// opened at the top of the page, and anyone holding two roles was listed twice.
//
// Read-only, since sign-in moved to Authentik: roles are derived from the
// Authentik group list at each sign-in, through the mapping under Inställningar
// → Roller, so a role granted here would last until the holder next signed in
// and then quietly revert. The place to change one is the mandate in Authentik,
// or the mapping. What this page is for now is answering "who holds
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

  // The person open in the dialog: picked from the table, or found by the
  // search, which reaches the ~980 members the table leaves out.
  const [inspecting, setInspecting] = useState<User | null>(null);
  // The looked-up member may have been re-synced since; prefer the live row.
  const live = inspecting ? holders.find((u) => u.id === inspecting.id) ?? inspecting : null;

  const held = (u: User) => ASSIGNABLE_ROLES.filter((r) => u.roles.includes(r));

  // By role, OR-ed: "who is Kassör or Vice" is one question.
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
            <span className="block truncate text-sm font-medium group-hover:text-accent group-hover:underline">
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
      mobileCell: (u) => held(u).map((r) => tRole(r)).join(", "),
      header: t("colRoles"),
      value: (u) => held(u).map((r) => tRole(r)).join(", "),
      sortable: true,
      cell: (u) => (
        <span className="flex flex-wrap gap-1">
          {held(u).map((r) => (
            <Tag key={r} tone="accent">{tRole(r)}</Tag>
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
          // The toolbar's search is over the whole section rather than over
          // these rows: finding somebody who is not here is the one thing the
          // table cannot do, and a second box that only narrowed two dozen
          // names would be a search for the wrong thing.
          action={
            <PersonSearch onSelect={setInspecting} className="w-full sm:w-72" />
          }
        />
        <p className="border-t border-border px-inset py-3 text-xs text-muted">
          {t("rolesSubtitle", { role: tRole("ORDINARIE") })}
        </p>
      </Card>

      {live && <PersonDialog key={live.id} person={live} onClose={() => setInspecting(null)} />}
    </>
  );
}

/** One member: the roles they hold, where each came from, their bank details,
 *  and the mail they have been sent. */
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
          {/* Every assignable role, held or not, rather than only the held
              ones: "does this person have attesträtt" is answered by the
              absence as much as by the presence, and a row of chips with one
              lit says it at a glance. */}
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

        {/* Bank details: same capability that already shows them on the
            booking screen, reached from a different door. A resultatansvarig
            with SETTINGS access to this page but not BOOKKEEPING still sees
            nothing here. */}
        {canBookkeep(user.capabilities) && <PayoutPanel userId={person.id} />}

        {/* The mail this member has been sent, and a test mail to send them.
            Here rather than only under E-post because the question usually
            arrives with a name attached: "Maja says she never got it". */}
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">{t("emailTitle")}</h3>
          <EmailLog recipient={{ id: person.id, name: person.name }} />
        </div>
      </ModalBody>
    </Modal>
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

  // The caller mounts this under a key, so switching member remounts rather
  // than reusing the panel, and there is no stale answer to clear.
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
                  {" - "}
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
                    {" - "}
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
                  "rounded-control border border-border px-2 py-0.5 font-mono text-xs",
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

/**
 * A member's bank details, fetched rather than passed down for the same
 * reason `WhyPanel` is: a thousand-row list carries nothing worth this until
 * one row is asked about. The caller only mounts this for a viewer who holds
 * `BOOKKEEPING`, so the fetch itself is the same lookup the booking screen
 * already makes, not a new way to reach the digits.
 */
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
