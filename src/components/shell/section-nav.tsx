"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useGoBack } from "@/components/shell/route-history";
import { IconChevronLeft } from "@/components/ui/icons";
import { PageTitle } from "@/components/shell/settings-title";
import { usePhone } from "@/lib/ui/media";
import { useScrollStrip } from "@/lib/ui/scroll-strip";
import { cn } from "@/lib/ui/utils";
import { NavCount } from "./nav-count";

export interface SectionNav {
  label: string;
  tabsLabel: string;
  tabs: {
    href: string;
    label: string;
    icon: (p: { className?: string }) => React.ReactNode;
    active: boolean;
    count: number;
  }[];
  root: boolean;
}

const Ctx = createContext<{
  nav: SectionNav | null;
  slot: HTMLElement | null;
  reportOwn: (own: boolean | null) => void;
}>({
  nav: null,
  slot: null,
  reportOwn: () => {},
});
export const SectionNavProvider = Ctx.Provider;

export function SectionBand({
  section,
  own,
  slotRef,
}: {
  section: SectionNav;
  own: boolean;
  slotRef: (el: HTMLElement | null) => void;
}) {
  const scrolled = usePageScrolled();
  return (
    <div
      data-guide-edge="top"
      className={cn(
        "sticky top-app-bar z-20 md:top-0 -ml-4 -mr-(--main-pr) mb-6 border-b border-border bg-background/90 pl-4 pr-(--main-pr) backdrop-blur-xl backdrop-saturate-150 md:-ml-6 md:pl-6",
        "-mt-6",
      )}
    >
      {own && (
        <h1 className="sr-only">
          {section.tabs.find((tab) => tab.active)?.label ?? section.label}
        </h1>
      )}
      <div className="relative flex h-11 items-stretch justify-between gap-4">
        <SectionTabs label={section.tabsLabel} tabs={section.tabs} />
        <div ref={slotRef} className="flex shrink-0 items-center empty:hidden" />
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-full h-6 bg-gradient-to-b from-canvas to-transparent transition-opacity duration-200",
          scrolled ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  back,
  right,
  aside,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: string;
  right?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const { nav, slot, reportOwn } = useContext(Ctx);
  const phone = usePhone();
  const own = Boolean(nav) && !back;
  useLayoutEffect(() => {
    if (!nav) return;
    reportOwn(own);
    return () => reportOwn(null);
  }, [nav, own, reportOwn]);

  if (own) {
    return (
      <>
        {right && (phone ? <div className="mb-4">{right}</div> : slot && createPortal(right, slot))}
        {subtitle && <p className="-mt-3 mb-6 text-lg font-medium tracking-tight">{subtitle}</p>}
      </>
    );
  }

  const inBand = Boolean(nav) && !phone && slot;
  const end = (!nav || phone) && right;
  return (
    <div className="mb-6 flex items-start gap-1.5">
      {inBand && right && createPortal(right, slot)}
      {back && <BackLink href={back} />}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <div className="col-start-1 row-start-1 min-w-0">
          <PageTitle>{title}</PageTitle>
        </div>
        {subtitle && (
          <p className="col-start-1 row-start-2 mt-1 text-lg font-medium tracking-tight">
            {subtitle}
          </p>
        )}
        {(aside || end) && (
          <div className="col-span-2 row-start-3 mt-3 flex min-w-0 items-center justify-end gap-2 md:col-span-1 md:col-start-2 md:row-start-1 md:mt-0 md:flex-wrap">
            {end}
            {aside}
          </div>
        )}
      </div>
    </div>
  );
}

export function PageHeaderSkeleton({
  back,
  right,
  title,
  aside,
}: {
  back: boolean;
  aside?: React.ReactNode;
  right?: React.ReactNode;
  title: React.ReactNode;
}) {
  const { nav } = useContext(Ctx);
  if (nav && !back) return null;
  const end = !nav && right;
  return (
    <div className="mb-6 flex items-start gap-1.5">
      {back && <div aria-hidden className="skeleton size-8 shrink-0 rounded-control" />}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <div className="col-start-1 row-start-1 min-w-0">{title}</div>
        {(aside || end) && (
          <div className="col-span-2 row-start-2 mt-3 flex min-w-0 items-center justify-end gap-2 md:col-span-1 md:col-start-2 md:row-start-1 md:mt-0 md:flex-wrap">
            {end}
            {aside}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTabs({ label, tabs }: { label: string; tabs: SectionNav["tabs"] }) {
  const strip = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const current = tabs.findIndex((i) => i.active);
  const [pending, setPending] = useState<{ index: number; from: number } | null>(null);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setPending(null);
  }
  const active = pending && pending.from === current ? pending.index : current;
  const section = tabs.map((i) => i.href).join("|");
  const lastSection = useRef<string | null>(null);

  useLayoutEffect(() => {
    const ul = list.current;
    const el = line.current;
    if (!ul || !el) return;
    const place = (animate: boolean) => {
      const tab = active >= 0 ? (ul.children[active] as HTMLElement | undefined) : undefined;
      el.style.opacity = tab ? "1" : "0";
      if (!tab) return;
      if (!animate) el.style.transition = "none";
      el.style.transform = `translateX(${tab.offsetLeft}px)`;
      el.style.width = `${tab.offsetWidth}px`;
      if (!animate) {
        void el.offsetWidth;
        el.style.transition = "";
      }
    };
    place(lastSection.current === section);
    lastSection.current = section;
    const ro = new ResizeObserver(() => place(true));
    ro.observe(ul);
    return () => ro.disconnect();
  }, [section, active]);

  useScrollStrip(strip, active, list);

  return (
    <nav aria-label={label} className="-mb-px flex min-w-0 flex-1" data-tour="section-tabs">
      <div
        ref={strip}
        className="scroll-strip relative flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
      >
        <ul ref={list} className="flex items-stretch gap-1">
          {tabs.map((i, n) => {
            const Icon = i.icon;
            const shown = n === active;
            return (
              <li key={i.href} className="flex shrink-0">
                <Link
                  href={i.href}
                  aria-current={i.active ? "page" : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    if (n !== current) setPending({ index: n, from: current });
                  }}
                  className={cn(
                    "flex items-center gap-2 border-b-2 border-transparent px-3 text-sm transition-colors",
                    shown
                      ? "font-medium text-foreground"
                      : "font-medium text-muted hover:border-border hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {i.label}
                  {i.count > 0 && <NavCount count={i.count} alert />}
                </Link>
              </li>
            );
          })}
        </ul>
        <span
          ref={line}
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-linear-to-r from-action-from to-action-to opacity-0 motion-safe:transition-[transform,width] motion-safe:duration-300 motion-safe:ease-[var(--ease-out-quint)]"
        />
      </div>
    </nav>
  );
}

function usePageScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const column = document.querySelector<HTMLElement>("[data-main-scroll]");
    const read = () => setScrolled((column?.scrollTop ?? 0) > 0 || window.scrollY > 0);
    read();
    column?.addEventListener("scroll", read, { passive: true });
    window.addEventListener("scroll", read, { passive: true });
    return () => {
      column?.removeEventListener("scroll", read);
      window.removeEventListener("scroll", read);
    };
  }, []);
  return scrolled;
}

function BackLink({ href }: { href: string }) {
  const t = useTranslations("common");
  const back = useGoBack(href);

  return (
    <Link
      href={back.href}
      onClick={back.onClick}
      aria-label={t("back")}
      title={t("back")}
      className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-hover hover:text-foreground"
    >
      <IconChevronLeft className="size-5" />
    </Link>
  );
}
