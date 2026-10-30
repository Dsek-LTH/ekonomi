"use client";

// My profile: who you are across the top, then what you can set, in two
// columns. A page of its own rather than the overlay it used to be: it holds
// four forms and the betyg, which a dialog-width column stacked into a long
// scroll. The account menu in the header keeps theme and language as well,
// being the two switches not worth a page load.
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { useMutation } from "@/components/shell/use-mutation";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Button, ButtonLink } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { FortnoxBanner } from "@/components/shell/fortnox-banner";
import { MemberScorePanel, StarRating } from "@/components/member-score";
import { UserAvatar } from "@/components/ui/avatar";
import { IconUpload } from "@/components/ui/icons";
import { NotificationSettings } from "./notification-settings";
import { AvatarDialog } from "./avatar-dialog";

import { useFormat } from "@/lib/ui/use-format";
import type { FortnoxStatus, NotificationKind, Role } from "@/lib/domain/types";
import type { MemberScore } from "@/lib/domain/member-score";

export function ProfileClient({
  userId,
  hasAvatar,
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
  userId: string;
  /** Whether a picture is set, which decides "Byt bild" and "Ta bort". */
  hasAvatar: boolean;
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
  /** Holds MEMBER_SCORE_VIEW, so the page has a Medlemmar tab. */
  showMembers: boolean;
}) {
  const t = useTranslations("common");
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
      width="content"
      pages={showMembers ? profileTabs(tProfile, "me") : undefined}
    >
      <ProfileHero userId={userId} name={name} email={email} roles={roles} score={score} hasAvatar={hasAvatar} />

      {/* The forms on the left, where the eye goes after the hero; the small
          things beside them. One column on a phone, in the same order, so the
          payout account (the one thing here a member is sent to fill in)
          stays first. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title={tProfile("payoutTitle")} subtitle={tProfile("payoutDescription")} />
            <CardBody className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                {/* Named, and told outright that they are not credentials.
                    Unnamed, these are two text fields over a Save button, which
                    is the shape of a login form, and a password manager
                    offering to put a username in Kontonummer is what that guess
                    looks like. `autoComplete="off"` is the standard half;
                    managers routinely ignore it, so 1Password's own opt-out
                    says it again in the one language it does read. If another
                    manager starts guessing here, it will have an attribute of
                    its own to add beside this one.

                    No `inputMode="numeric"`: the format asked for carries a
                    hyphen and spaces (see the placeholders), and a digits-only
                    keypad on a phone has no way to type either. */}
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
              <div className="flex justify-end">
                <Button onClick={save} loading={saving} disabled={!dirty}>
                  {tProfile("save")}
                </Button>
              </div>
            </CardBody>
          </Card>

          <NotificationSettings email={email} initial={notifications} />

          {/* The hero's stars link here. */}
          <Card id="betyg" className="scroll-mt-20">
            <CardHeader title={tScore("title")} subtitle={tScore("ownSubtitle")} />
            <CardBody>
              <MemberScorePanel score={score} own />
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {/* Only rendered for the treasury. Everyone else has no Fortnox
              login to have an opinion about. */}
          {fortnox && (
            <Card>
              <CardHeader title="Fortnox" subtitle={tProfile("fortnoxSubtitle")} />
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

          <Card>
            <CardHeader title={tProfile("appearance")} />
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
        </div>
      </div>
    </PageShell>
  );
}

/**
 * Who you are, across the top: the picture (and the way to change it), the
 * name, the address the mail goes to, the roles, and the betyg. Sign out sits
 * here too, as the one thing on the page about the session rather than the
 * person.
 */
function ProfileHero({
  userId,
  name,
  email,
  roles,
  score,
  hasAvatar,
}: {
  userId: string;
  name: string;
  email: string;
  roles: Role[];
  score: MemberScore;
  hasAvatar: boolean;
}) {
  const t = useTranslations("common");
  const tRole = useTranslations("common.role");
  const tProfile = useTranslations("profile");
  const tScore = useTranslations("score");
  const { pending, mutate } = useMutation();
  const picker = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<File | null>(null);

  const pick = () => picker.current?.click();
  const remove = () =>
    mutate("/api/profile/avatar", {
      key: "removeAvatar",
      method: "DELETE",
      success: tProfile("avatar.removed"),
      error: tProfile("avatar.removeFailed"),
    });

  return (
    <Card>
      <div className="flex flex-col items-center gap-5 px-inset py-6 text-center sm:flex-row sm:items-center sm:text-left">
        {/* The picture is its own button: pressing your own face to change it
            is the move people try first. */}
        <button
          type="button"
          onClick={pick}
          aria-label={hasAvatar ? tProfile("avatar.change") : tProfile("avatar.upload")}
          className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <UserAvatar userId={userId} name={name} size="xl" />
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <IconUpload className="size-6" />
          </span>
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared, so picking the same file again still fires a change.
            e.target.value = "";
            if (file) setCropping(file);
          }}
        />

        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="truncate text-xl font-semibold">{name}</h2>
            <p className="truncate text-sm text-muted">{email}</p>
          </div>
          <ul className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
            {(roles.length ? roles : (["ORDINARIE"] as Role[])).map((r) => (
              <li key={r} className="rounded-mark bg-surface px-2 py-0.5 text-xs font-medium">
                {tRole(r)}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-sm sm:justify-start">
            <button type="button" onClick={pick} className="font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current">
              {hasAvatar ? tProfile("avatar.change") : tProfile("avatar.upload")}
            </button>
            {hasAvatar && (
              <button
                type="button"
                onClick={remove}
                disabled={pending === "removeAvatar"}
                className="font-medium text-muted underline decoration-faint underline-offset-2 hover:text-foreground hover:decoration-current disabled:opacity-40"
              >
                {tProfile("avatar.remove")}
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-3 sm:items-end">
          <a href="#betyg" className="flex flex-col items-center gap-1 rounded-control px-2 py-1 transition-colors hover:bg-hover sm:items-end">
            <span className="text-xs text-muted">{tScore("title")}</span>
            <StarRating value={score.stars} />
          </a>
          <Button variant="dangerOutline" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
            {t("signOut")}
          </Button>
        </div>
      </div>
      {cropping && <AvatarDialog file={cropping} onClose={() => setCropping(null)} />}
    </Card>
  );
}

/** The profile's two tabs, for the holders of MEMBER_SCORE_VIEW. Shared with
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
