"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconAlert, IconCheck, IconInfo, IconX } from "@/components/ui/icons";
import { cn, uid } from "@/lib/ui/utils";

// One unified way to surface every transient message in the app: a stack of
// dismissible banners at the top of the page content. Errors persist until
// dismissed; success/info auto-dismiss after a few seconds. Use via useNotify().

export type NotifyTone = "error" | "success" | "info";

export interface Notification {
  id: string;
  tone: NotifyTone;
  title?: string;
  message: string;
}

interface NotifyApi {
  error: (message: string, title?: string) => string;
  success: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const AUTO_DISMISS_MS: Record<NotifyTone, number | null> = {
  // Errors stay until the user dismisses them; positive/neutral messages fade.
  error: null,
  success: 5000,
  info: 6000,
};

const Ctx = createContext<NotifyApi | null>(null);

// Separate context for the live list so the banner region re-renders on every
// notification while pages (which only consume the stable useNotify API) don't.
const ListCtx = createContext<{ items: Notification[]; dismiss: (id: string) => void } | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Notification[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setItems((cur) => cur.filter((n) => n.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (tone: NotifyTone, message: string, title?: string) => {
      const id = uid();
      setItems((cur) => [...cur, { id, tone, title, message }]);
      const ms = AUTO_DISMISS_MS[tone];
      if (ms != null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ms),
        );
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<NotifyApi>(
    () => ({
      error: (message, title) => push("error", message, title),
      success: (message, title) => push("success", message, title),
      info: (message, title) => push("info", message, title),
      dismiss,
      clear: () => setItems([]),
    }),
    [push, dismiss],
  );

  const listValue = useMemo(() => ({ items, dismiss }), [items, dismiss]);

  return (
    <Ctx.Provider value={api}>
      <ListCtx.Provider value={listValue}>{children}</ListCtx.Provider>
    </Ctx.Provider>
  );
}

export function useNotify(): NotifyApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotify must be used within NotificationsProvider");
  return ctx;
}

// Backgrounds are deliberately translucent: the banners float over the page and
// blur what's behind them, which only reads as blur if some of it shows through.
//
// Written as color-mix rather than the `/85` opacity modifier on purpose — that
// modifier resolves the theme colour at build time and bakes in the light-theme
// hex, so the banners would keep their light background in dark mode.
const TONE_STYLE: Record<NotifyTone, { wrap: string; icon: React.ReactNode }> = {
  error: {
    wrap:
      "border-danger/30 bg-[color-mix(in_srgb,var(--color-danger-soft)_85%,transparent)] text-danger",
    icon: <IconAlert className="size-5 shrink-0" />,
  },
  success: {
    wrap:
      "border-success/30 bg-[color-mix(in_srgb,var(--color-success-soft)_85%,transparent)] text-success",
    icon: <IconCheck className="size-5 shrink-0" />,
  },
  info: {
    wrap:
      "border-accent/30 bg-[color-mix(in_srgb,var(--color-accent-soft)_85%,transparent)] text-accent",
    icon: <IconInfo className="size-5 shrink-0" />,
  },
};

// Floats over the page instead of sitting in the content flow, so arriving
// notifications never reflow what the user is reading. Mounted once in the app
// layout; z-60 puts it above the sidebar and popovers but below the confirm
// dialog and the receipt viewer, which are modal and should own the screen.
export function NotificationBanners() {
  const tCommon = useTranslations("common");
  const list = useContext(ListCtx);
  if (!list || list.items.length === 0) return null;
  return (
    // The container ignores the pointer so the page stays usable around the
    // banners; each banner takes it back for its own close button.
    // Above the dialogs, not below them. A toast reports what just happened,
    // and what just happened is usually the thing somebody pressed in a dialog
    // — at z-60 the answer to "save this product" appeared behind the form
    // that asked. Modals sit at 200 and a combobox's menu at 210, so this
    // clears both.
    <div className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-[220] flex justify-center px-4 md:top-6">
      <div className="flex w-full max-w-lg flex-col gap-2">
        {list.items.map((n) => {
          const t = TONE_STYLE[n.tone];
          return (
            <div
              key={n.id}
              role={n.tone === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md",
                t.wrap,
              )}
            >
              {t.icon}
              <div className="min-w-0 flex-1 leading-snug">
                {n.title && <p className="font-semibold">{n.title}</p>}
                <p className={cn(n.title && "text-foreground/80")}>{n.message}</p>
              </div>
              <button
                type="button"
                onClick={() => list.dismiss(n.id)}
                aria-label={tCommon("close")}
                className="-mr-1 -mt-0.5 rounded-md p-1 opacity-70 transition hover:opacity-100"
              >
                <IconX className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
