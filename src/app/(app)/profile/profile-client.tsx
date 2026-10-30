"use client";

// My profile: everything about this session in one place, and where the
// sidebar's footer leads. The sidebar keeps only theme and language, being the
// two switches not worth a page load; the rest lives here.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { useMutation } from "@/components/shell/use-mutation";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DetailList, DetailRow } from "@/components/ui/detail-list";
import { Field, Input } from "@/components/ui/field";
import { Button, ButtonLink } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { FortnoxBanner } from "@/components/shell/fortnox-banner";
import { MemberScorePanel } from "@/components/member-score";
import { NotificationSettings } from "./notification-settings";

import { useFormat } from "@/lib/ui/use-format";
import type { FortnoxStatus, NotificationKind, Role } from "@/lib/domain/types";
import type { MemberScore } from "@/lib/domain/member-score";

export function ProfileClient({
  name,
  email,
  roles,
  clearing: c0,
  account: a0,
  fortnox,
  notifications,
  score,
  showMembers,
}: {
  name: string;
  email: string;
  roles: Role[];
  clearing: string;
  account: string;
  /** Absent for everyone who doesn't book in Fortnox under their own login. */
  fortnox?: { session: FortnoxStatus["session"] | null };
  /** The emails this member can be sent, and whether each is on. */
  notifications: { kind: NotificationKind; enabled: boolean }[];
  /** The member's own redovisningsbetyg, which only they and the treasury see. */
  score: MemberScore;
  /** Holds MEMBER_SCORE_VIEW, so the overlay has a Medlemmar tab. */
  showMembers: boolean;
}) {
  const t = useTranslations("common");
  const tRole = useTranslations("common.role");
  const tProfile = useTranslations("profile");
  const tNav = useTranslations("nav");
  const tScore = useTranslations("score");
  const { dateTime } = useFormat();
  const { pending, mutate } = useMutation();
  const [clearing, setClearing] = useState(c0);
  const [account, setAccount] = useState(a0);
  const dirty = clearing !== c0 || account !== a0;
  const saving = pending === "payout";

  const save = () =>
    mutate("/api/profile", {
      key: "payout",
      method: "PATCH",
      body: { bankClearingNumber: clearing, bankAccountNumber: account },
      success: tProfile("saved"),
      error: tProfile("saveFailed"),
    });

  const session = fortnox?.session;

  return (
    <PageShell
      title={tNav("profile")}
      width="form"
      pages={showMembers ? profileTabs(tProfile, "me") : undefined}
    >
      <Card>
        <CardBody className="space-y-5">
          <DetailList>
            <DetailRow label={tProfile("name")} value={name} />
            <DetailRow label={tProfile("email")} value={email} />
            <DetailRow
              label={tProfile("roles")}
              value={roles.length ? roles.map((r) => tRole(r)).join(" - ") : tRole("ORDINARIE")}
            />
          </DetailList>

          <div>
            <h2 className="text-base font-semibold">{tProfile("payoutTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{tProfile("payoutDescription")}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {/* Named, and told outright that they are not credentials.
                Unnamed, these are two text fields over a Save button, which is
                the shape of a login form, and a password manager offering to
                put a username in Kontonummer is what that guess looks like.
                `autoComplete="off"` is the standard half; managers routinely
                ignore it, so 1Password's own opt-out says it again in the one
                language it does read. If another manager starts guessing here,
                it will have an attribute of its own to add beside this one.

                No `inputMode="numeric"`: the format asked for carries a hyphen
                and spaces (see the placeholders), and a digits-only keypad on a
                phone has no way to type either. */}
            <Field label={tProfile("clearing")}>
              <Input
                name="bank-clearing"
                autoComplete="off"
                data-1p-ignore
                value={clearing}
                placeholder={tProfile("clearingPlaceholder")}
                onChange={(e) => setClearing(e.target.value)}
              />
            </Field>
            <Field label={tProfile("account")}>
              <Input
                name="bank-account"
                autoComplete="off"
                data-1p-ignore
                value={account}
                placeholder={tProfile("accountPlaceholder")}
                onChange={(e) => setAccount(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={save} loading={saving} disabled={!dirty}>
              {tProfile("save")}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={tScore("title")} subtitle={tScore("ownSubtitle")} />
        <CardBody>
          <MemberScorePanel score={score} own />
        </CardBody>
      </Card>

      {/* Only rendered for the treasury. Everyone else has no Fortnox login to
          have an opinion about. */}
      {fortnox && (
        <Card>
          <CardHeader
            title="Fortnox"
            subtitle={tProfile("fortnoxSubtitle")}
          />
          <CardBody className="space-y-4">
            <FortnoxBanner
              ok={!!session}
              title={
                session
                  ? session.fortnoxUserName
                    ? tProfile("signedInAs", { name: session.fortnoxUserName })
                    : tProfile("signedIn")
                  : tProfile("notSignedIn")
              }
              detail={
                session
                  ? tProfile("validUntil", { time: dateTime(session.expiresAt) })
                  : tProfile("fortnoxRequired")
              }
            />

            <div className="flex flex-wrap gap-2.5">
              <ButtonLink
                href={`/api/fortnox/connect?mode=user&returnTo=${encodeURIComponent("/profile")}`}
                variant={session ? "secondary" : "primary"}
              >
                {session ? tProfile("signInAgain") : tProfile("signInFortnox")}
              </ButtonLink>
              {session && (
                <Button
                  variant="secondary"
                  loading={pending === "fortnoxLogout"}
                  onClick={() =>
                    mutate("/api/fortnox/session", {
                      key: "fortnoxLogout",
                      method: "DELETE",
                      success: tProfile("fortnoxSignedOut"),
                      error: tProfile("fortnoxSignOutFailed"),
                    })
                  }
                >
                  {tProfile("signOutFortnox")}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted">{tProfile("signOutNote")}</p>
          </CardBody>
        </Card>
      )}

      <NotificationSettings email={email} initial={notifications} />

      <Card>
        <CardHeader title={tNav("settings")} />
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">{t("theme")}</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted">{t("language")}</span>
            <LanguageSwitcher />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Button
            variant="dangerOutline"
            className="w-full"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            {t("signOut")}
          </Button>
        </CardBody>
      </Card>
    </PageShell>
  );
}

/** The overlay's two tabs, for the holders of MEMBER_SCORE_VIEW. Shared with
 *  members/members-client.tsx, the other of them. */
export function profileTabs(t: (key: string) => string, value: "me" | "members") {
  return {
    label: t("tabs.label"),
    value,
    options: [
      { value: "me", label: t("tabs.me"), href: "/profile" },
      { value: "members", label: t("tabs.members"), href: "/profile/members" },
    ],
  };
}
