"use client";

// The phone's tab bar: the few places most members go, a thumb's reach from
// wherever they are, and "Mer" for the rest.
//
// The menu used to be the only way round on a phone, so every trip was two
// taps (open it, pick the page) and the commonest one, a new utlägg, was three.
// Now that is one tap, and so are Översikt and Utlägg. The fourth tab is
// whichever errand this member has most: attest for somebody who signs,
// otherwise their card's purchases, otherwise the budget. "Mer" opens the
// full menu (mobile-nav.tsx), and carries a dot when something waiting is
// behind it rather than on a tab.
//
// "+" asks which kind first, a purchase or a milersättning, because the two
// are different forms and neither can be drawn before that is answered (see
// components/new-expense-menu.tsx). From the bottom, where the thumb already is.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useProgressRouter } from "@/components/shell/route-progress";
import {
  IconBudget,
  IconCar,
  IconCard,
  IconGrid,
  IconInvoice,
  IconMenu,
  IconPlus,
  IconReceipt,
} from "@/components/ui/icons";
import { canAccessBudget, hasAttestRole } from "@/lib/domain/permissions";
import type { CurrentUser } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";
import { NavCount } from "./nav-count";

type Tab = { href: string; label: string; icon: (p: { className?: string }) => React.ReactNode };

export function TabBar({
  user,
  isActive,
  counts,
  onMore,
}: {
  user: CurrentUser;
  isActive: (href: string) => boolean;
  counts: Record<string, number>;
  onMore: () => void;
}) {
  const t = useTranslations("nav");
  const tNew = useTranslations("expenses.newMenu");
  const router = useProgressRouter();
  const [choosing, setChoosing] = useState(false);

  // An attester's other list: their utlägg to attest are on Utlägg already,
  // and the levfakturor are the rest of what they sign.
  const fourth: Tab | null = hasAttestRole(user.capabilities)
    ? { href: "/invoices", label: "invoices", icon: IconInvoice }
    : user.holdsCard
      ? { href: "/bank", label: "bank", icon: IconCard }
      : canAccessBudget(user.capabilities)
        ? { href: "/budget", label: "budget", icon: IconBudget }
        : null;
  const tabs: Tab[] = [
    { href: "/dashboard", label: "overview", icon: IconGrid },
    { href: "/expenses", label: "expenses", icon: IconReceipt },
  ];
  const onTabs = new Set([...tabs, ...(fourth ? [fourth] : [])].map((x) => x.href));
  // Something is waiting somewhere only the full menu leads to.
  const moreWaiting = Object.entries(counts).some(([href, n]) => n > 0 && !onTabs.has(href));

  // Escape closes the chooser, as it closes every sheet in the app.
  useEffect(() => {
    if (!choosing) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setChoosing(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [choosing]);

  const go = (href: string) => {
    setChoosing(false);
    router.push(href);
  };

  const tab = (x: Tab) => {
    const Icon = x.icon;
    const active = isActive(x.href);
    const n = counts[x.href] ?? 0;
    return (
      <Link
        key={x.href}
        href={x.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1 pt-2 text-[11px] font-medium",
          active ? "text-accent" : "text-muted",
        )}
      >
        <span className="relative">
          <Icon className="size-[22px]" />
          {n > 0 && <NavCount count={n} overlay className="absolute -right-3 -top-1.5" />}
        </span>
        <span className="max-w-full truncate">{t(x.label)}</span>
      </Link>
    );
  };

  return (
    <>
      {choosing && (
        <div className="fixed inset-0 z-40 md:hidden print:hidden">
          <button
            type="button"
            aria-label={t("closeNew")}
            onClick={() => setChoosing(false)}
            className="absolute inset-0 bg-foreground/30"
          />
          <div
            role="dialog"
            aria-label={tNew("label")}
            className="absolute inset-x-0 bottom-0 rounded-t-panel border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 shadow-[var(--shadow-card)]"
          >
            <p className="px-1 pb-2 text-sm font-semibold">{tNew("label")}</p>
            <div className="space-y-2">
              {[
                { href: "/expenses/new", icon: IconReceipt, label: tNew("ordinary"), hint: tNew("ordinaryHint") },
                { href: "/expenses/new/mileage", icon: IconCar, label: tNew("mileage"), hint: tNew("mileageHint") },
              ].map((c) => (
                <button
                  key={c.href}
                  type="button"
                  autoFocus={c.href === "/expenses/new"}
                  onClick={() => go(c.href)}
                  className="flex w-full items-center gap-3 rounded-control border border-border px-4 py-3 text-left active:bg-surface"
                >
                  <c.icon className="size-5 shrink-0 text-accent" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-muted">{c.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label={t("tabBar")}
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-background/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden print:hidden"
      >
        {tabs.map(tab)}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => setChoosing(true)}
            aria-label={tNew("label")}
            aria-expanded={choosing}
            className="action-fill flex size-11 items-center justify-center rounded-full text-white shadow-[var(--shadow-card)] active:scale-95"
          >
            <IconPlus className="size-5" />
          </button>
        </div>
        {fourth && tab(fourth)}
        <button
          type="button"
          onClick={onMore}
          className="flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1 pt-2 text-[11px] font-medium text-muted"
        >
          <span className="relative">
            <IconMenu className="size-[22px]" />
            {moreWaiting && (
              <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-action-to ring-2 ring-background" />
            )}
          </span>
          <span>{t("more")}</span>
        </button>
      </nav>
    </>
  );
}
