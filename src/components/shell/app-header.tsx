"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useProgressRouter } from "@/components/shell/route-progress";
import { UserAvatar } from "@/components/ui/avatar";
import { IconCheck, IconExternal, IconHelp, IconMenu } from "@/components/ui/icons";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import type { CurrentUser, FortnoxStatus } from "@/lib/domain/types";
import {
  fiscalYearApplies,
  fiscalYearLabel,
  rememberFiscalYear,
  type FiscalYear,
} from "@/lib/ui/fiscal-year";
import { cn } from "@/lib/ui/utils";
import { IconFortnox } from "./fortnox-mark";
import { useGuides } from "./guide";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeToggle } from "./theme-toggle";

const DSEK_URL = "https://dsek.se";

export interface FiscalYears {
  years: FiscalYear[];
  selected: FiscalYear;
}

export function AppHeader({
  user,
  fortnox,
  fiscal,
  navOpen,
  navToggleRef,
  onToggleNav,
  waiting,
}: {
  user: CurrentUser;
  fortnox?: { session: FortnoxStatus["session"] | null; company: string | null };
  fiscal: FiscalYears | null;
  navOpen: boolean;
  navToggleRef: React.RefObject<HTMLButtonElement | null>;
  onToggleNav: () => void;
  waiting: boolean;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <header className="z-30 hidden box-content h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:flex print:hidden">
      <button
        ref={navToggleRef}
        type="button"
        onClick={onToggleNav}
        aria-expanded={navOpen}
        aria-controls="app-nav"
        className={cn(
          "action-fill relative flex h-8 shrink-0 items-center gap-2 rounded-control border px-2.5 text-sm font-medium text-white",
          navOpen && "shadow-[inset_0_0_0_999px_rgb(0_0_0/0.08)]",
        )}
      >
        <IconMenu className="size-4" />
        {t("menu")}
        {waiting && !navOpen && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 size-2.5 rounded-full bg-action-to ring-2 ring-background"
          />
        )}
      </button>

      <Link href="/dashboard" className="flex shrink-0 items-center gap-2 rounded-control">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/symbol_rosa.svg" alt="D-sektionen" className="h-6" />
        <span className="text-sm font-semibold">{t("brandTagline")}</span>
      </Link>

      <div className="ms-auto flex items-center gap-2">
        <Link
          href="/faq"
          data-tour="faq"
          aria-current={pathname === "/faq" ? "page" : undefined}
          className={cn(
            "flex h-8 items-center gap-2 rounded-control px-2.5 text-sm font-medium transition-colors hover:bg-hover",
            pathname === "/faq" && "bg-hover",
          )}
        >
          <IconHelp aria-hidden className="size-4" />
          {t("faq")}
        </Link>
        {fortnox && <FortnoxStatusButton session={fortnox.session} company={fortnox.company} />}
        {fiscal && <FiscalYearPicker fiscal={fiscal} />}
        <AccountMenu user={user} />
      </div>
    </header>
  );
}

export function FiscalYearPicker({ fiscal }: { fiscal: FiscalYears }) {
  const t = useTranslations("nav");
  const router = useProgressRouter();
  const pathname = usePathname();
  const applies = fiscalYearApplies(pathname);
  const year = fiscalYearLabel(fiscal.selected);

  function pick(y: FiscalYear) {
    rememberFiscalYear(y.id);
    if (pathname.startsWith("/closing/vouchers/")) router.push("/closing/vouchers");
    else router.refresh();
  }

  return (
    <span title={applies ? undefined : t("fiscalYearNotHere")} data-tour="fiscal-year">
      <Menu
        label={year}
        accessibleName={`${t("fiscalYear")} ${year}`}
        variant="quiet"
        className="[&_button]:gap-1 [&_button]:px-2"
        narrow
        disabled={!applies}
      >
        {fiscal.years.map((y) => (
          <MenuItem key={y.id} onClick={() => pick(y)}>
            <span className="flex-1">{fiscalYearLabel(y)}</span>
            {y.id === fiscal.selected.id && <IconCheck className="size-4 text-muted" />}
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}

function FortnoxStatusButton({
  session,
  company,
}: {
  session: FortnoxStatus["session"] | null;
  company: string | null;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const signedIn = Boolean(session);
  const state = signedIn ? t("fortnoxSignedIn") : t("fortnoxSignIn");
  const label = company ? `${state} - ${company}` : state;
  return (
    <a
      href={`/api/fortnox/connect?mode=user&returnTo=${encodeURIComponent(pathname)}`}
      title={label}
      aria-label={label}
      className="flex h-8 items-center gap-2 rounded-control px-2.5 text-sm font-medium transition-colors hover:bg-hover"
    >
      <IconFortnox className="size-4" />
      <span className="max-w-48 truncate">{company ?? "Fortnox"}</span>
      <span
        aria-hidden
        className={cn("size-2 rounded-full", signedIn ? "bg-success" : "bg-warning")}
      />
    </a>
  );
}

function AccountMenu({ user }: { user: CurrentUser }) {
  const t = useTranslations("common");
  const tNav = useTranslations("nav");
  const tGuides = useTranslations("guides");
  const router = useProgressRouter();
  const { pageGuide, start, hold } = useGuides();
  return (
    <Menu
      label={tNav("accountMenu")}
      holdOpen={hold === "account"}
      trigger={<UserAvatar userId={user.id} name={user.name} />}
      triggerClassName="flex rounded-full transition-opacity hover:opacity-80"
    >
      <div className="px-2.5 pb-2 pt-1.5 leading-tight">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted">{user.email}</p>
      </div>
      <MenuItem onClick={() => router.push("/profile")}>{tNav("profile")}</MenuItem>
      <MenuSeparator />
      <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted">{tGuides("menuHeading")}</p>
      {pageGuide && pageGuide.id !== "start" && (
        <MenuItem onClick={() => start(pageGuide.id)}>{tGuides("thisPage")}</MenuItem>
      )}
      <MenuItem onClick={() => start("start")}>{tGuides("tour")}</MenuItem>
      <MenuSeparator />
      <div className="flex items-center justify-between gap-4 px-2.5 py-1.5" data-tour="theme">
        <span className="text-sm">{t("theme")}</span>
        <ThemeToggle round />
      </div>
      <div className="flex items-center justify-between gap-4 px-2.5 py-1.5" data-tour="language">
        <span className="text-sm">{t("language")}</span>
        <LanguageSwitcher round />
      </div>
      <MenuSeparator />
      {/* A new tab, because leaving takes somebody out of a form they may be halfway through, and `noopener` because a tab we opened must not be handed a way to steer this one. */}
      <MenuItem onClick={() => window.open(DSEK_URL, "_blank", "noopener,noreferrer")}>
        <span className="flex-1">{tNav("toDsek")}</span>
        <IconExternal aria-hidden className="size-3.5 text-muted" />
      </MenuItem>
      <MenuItem onClick={() => signOut({ callbackUrl: "/login" })}>{t("signOut")}</MenuItem>
    </Menu>
  );
}
