"use client";

// The bar across the top of the frame, over the nav and the page both: what
// applies to the whole app rather than to one area of it. On the left the menu
// button and the brand; on the right the treasury's Fortnox login,
// the räkenskapsår and the reader's own menu.
//
// These used to live at the foot of the rail, where they were only on screen
// while the rail was open, and the year has no home anywhere else: it is a
// filter over every page at once, one level above the scope switch (see
// docs/navigation.md). The rail is navigation and nothing else now.
//
// From md only. The phone keeps its own top bar (app-shell.tsx), which takes
// the year picker from here and leaves the rest to its menu.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useProgressRouter } from "@/components/shell/route-progress";
import { Avatar } from "@/components/ui/avatar";
import { IconCheck, IconExternal, IconMenu } from "@/components/ui/icons";
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
import { LanguageSwitcher } from "./language-switcher";
import { ThemeToggle } from "./theme-toggle";

/** The section's own site, from the account menu. Not a route of this app:
 *  this app is one thing the section runs. */
const DSEK_URL = "https://dsek.se";

export interface FiscalYears {
  years: FiscalYear[];
  /** The one in force, as the server resolved it. See lib/server/fiscal-year.ts. */
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
  fortnox?: { session: FortnoxStatus["session"] | null };
  fiscal: FiscalYears | null;
  /** Whether the nav panel is showing. This button is the only way to it. */
  navOpen: boolean;
  /** The button, which the panel's press-outside dismissal treats as inside. */
  navToggleRef: React.RefObject<HTMLButtonElement | null>;
  onToggleNav: () => void;
  /** Something waits behind one of the nav's links. With the nav shut the
   *  counts beside them are out of sight, so the button carries a dot. */
  waiting: boolean;
}) {
  const t = useTranslations("nav");
  return (
    // `box-content`, so the 64px is all room for the controls and the rule is
    // drawn below it. Inside it, the rule took a pixel of the height and a 40px
    // button sat 11.5px from the top and 11.5 from the line, which the browser
    // rounds to an off-centre 11 and 12.
    <header className="z-30 hidden box-content h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:flex print:hidden">
      <button
        ref={navToggleRef}
        type="button"
        onClick={onToggleNav}
        aria-expanded={navOpen}
        aria-controls="app-nav"
        className={cn(
          // The section's pink as a fill, the primary button's look, in the
          // year picker's type (text-base, font-medium). Darkened a touch while
          // the panel is open, so the button says it is pressed in.
          "relative flex h-10 shrink-0 items-center gap-2 rounded-control border border-brand-edge px-3 text-base font-medium brand-fill text-on-brand shadow-[var(--shadow-card)] transition-[filter,scale] hover:brightness-95 active:scale-[0.98]",
          navOpen && "brightness-90 hover:brightness-90",
        )}
      >
        <IconMenu className="size-4" />
        {t("menu")}
        {/* Off the corner rather than inside it: a pink dot on a pink fill
            would not be seen. */}
        {waiting && !navOpen && (
          <span aria-hidden className="absolute -right-1 -top-1 size-2.5 rounded-full bg-accent ring-2 ring-background" />
        )}
      </button>

      {/* The app's name, and the way home to Översikt, which is what a click
          on an app's name is expected to do. The D says whose app it is, so
          the text only has to say which one. It used to read "D-sektionen"
          over "Ekonomi" on two lines and go out to dsek.se; that link is in
          the account menu now. */}
      <Link href="/dashboard" className="flex shrink-0 items-center gap-2 rounded-control">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/symbol_rosa.svg" alt="D-sektionen" className="h-8" />
        <span className="text-base font-semibold">{t("brandTagline")}</span>
      </Link>

      <div className="ms-auto flex items-center gap-2">
        {fortnox && <FortnoxStatusButton session={fortnox.session} />}
        {fiscal && <FiscalYearPicker fiscal={fiscal} />}
        <AccountMenu user={user} />
      </div>
    </header>
  );
}

/**
 * The räkenskapsår, for every page it narrows, and greyed out on the ones it
 * does not, so the header keeps its shape from page to page.
 *
 * Writing the cookie and refreshing is the whole of it: the server reads the
 * year (getFiscalYear) and every page that cares asks for it there.
 */
export function FiscalYearPicker({ fiscal }: { fiscal: FiscalYears }) {
  const t = useTranslations("nav");
  const router = useProgressRouter();
  const pathname = usePathname();
  const applies = fiscalYearApplies(pathname);
  const year = fiscalYearLabel(fiscal.selected);

  function pick(y: FiscalYear) {
    rememberFiscalYear(y.id);
    // A voucher is one year's, so its page has nothing to show for another:
    // back to the year's vouchers. Everywhere else the page reads the year from
    // the cookie and only has to be asked again.
    if (pathname.startsWith("/closing/vouchers/")) router.push("/closing/vouchers");
    else router.refresh();
  }

  return (
    // The reason it is grey, on hover, since a disabled button says nothing.
    <span title={applies ? undefined : t("fiscalYearNotHere")}>
      {/* The year alone on the button. What it is a year of goes to the
          accessible name, since a bare number says nothing to a screen
          reader. */}
      <Menu
        label={year}
        accessibleName={`${t("fiscalYear")} ${year}`}
        variant="quiet"
        size="lg"
        className="[&_button]:px-3"
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

/**
 * The treasury's own Fortnox login. On screen signed in as well as signed
 * out, and the dot says which: the session is short-lived by design, so a
 * button that only appeared once it had lapsed would be one nobody could get
 * ahead of. Signed in it is quiet and still clickable, which is how a session
 * about to go is renewed.
 *
 * A plain `<a>`: /api/fortnox/connect is a redirect out to Fortnox's consent
 * screen, and the client router would ask for a page that never arrives.
 */
function FortnoxStatusButton({ session }: { session: FortnoxStatus["session"] | null }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const signedIn = Boolean(session);
  const label = signedIn ? t("fortnoxSignedIn") : t("fortnoxSignIn");
  return (
    <a
      href={`/api/fortnox/connect?mode=user&returnTo=${encodeURIComponent(pathname)}`}
      title={label}
      aria-label={label}
      className="flex h-10 items-center gap-2 rounded-control px-3 text-base font-medium transition-colors hover:bg-hover"
    >
      <IconFortnox className="size-4" />
      {/* The name alone. Whether the session holds is the dot's to say, and
          the full sentence is the title and the accessible name. */}
      <span>Fortnox</span>
      <span
        aria-hidden
        className={cn("size-2 rounded-full", signedIn ? "bg-success" : "bg-warning")}
      />
    </a>
  );
}

/**
 * The reader's own corner: who is signed in, the way to /profile, and the two
 * switches worth reaching from anywhere without a page load (theme and
 * language). One click from every page, where it used to take opening the rail
 * first.
 */
function AccountMenu({ user }: { user: CurrentUser }) {
  const t = useTranslations("common");
  const tNav = useTranslations("nav");
  const router = useProgressRouter();
  return (
    <Menu
      label={tNav("accountMenu")}
      trigger={<Avatar initials={user.initials} />}
      triggerClassName="flex rounded-full transition-opacity hover:opacity-80"
    >
      <div className="px-2.5 pb-2 pt-1.5 leading-tight">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted">{user.email}</p>
      </div>
      <MenuItem onClick={() => router.push("/profile")}>{tNav("profile")}</MenuItem>
      <MenuSeparator />
      {/* Switches rather than items: they act in place, and the menu stays
          open so the reader sees what they did. */}
      <div className="flex items-center justify-between gap-4 px-2.5 py-1.5">
        <span className="text-sm">{t("theme")}</span>
        <ThemeToggle />
      </div>
      <div className="flex items-center justify-between gap-4 px-2.5 py-1.5">
        <span className="text-sm">{t("language")}</span>
        <LanguageSwitcher />
      </div>
      <MenuSeparator />
      {/* A new tab, because leaving takes somebody out of a form they may be
          halfway through, and `noopener` because a tab we opened must not be
          handed a way to steer this one. */}
      <MenuItem onClick={() => window.open(DSEK_URL, "_blank", "noopener,noreferrer")}>
        <span className="flex-1">{tNav("toDsek")}</span>
        <IconExternal aria-hidden className="size-3.5 text-muted" />
      </MenuItem>
      <MenuItem onClick={() => signOut({ callbackUrl: "/login" })}>{t("signOut")}</MenuItem>
    </Menu>
  );
}
