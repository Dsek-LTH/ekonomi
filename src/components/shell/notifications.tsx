"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { IconAlert, IconCheck, IconInfo, IconX } from "@/components/ui/icons";
import { cn, uid } from "@/lib/ui/utils";

type NotifyTone = "error" | "success" | "info";

interface NotifyAction {
  href: string;
  label: string;
}

interface Notification {
  id: string;
  tone: NotifyTone;
  title?: string;
  message: string;
  action?: NotifyAction;
}

type NotifyOptions = string | { title?: string; action?: NotifyAction };

interface NotifyApi {
  error: (message: string, opts?: NotifyOptions) => string;
  success: (message: string, opts?: NotifyOptions) => string;
  info: (message: string, opts?: NotifyOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const normalise = (opts?: NotifyOptions) =>
  typeof opts === "string" ? { title: opts } : (opts ?? {});

const AUTO_DISMISS_MS: Record<NotifyTone, number | null> = {
  error: null,
  success: 5000,
  info: 6000,
};

const Ctx = createContext<NotifyApi | null>(null);

const ListCtx = createContext<{ items: Notification[]; dismiss: (id: string) => void } | null>(
  null,
);

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
    (tone: NotifyTone, message: string, opts?: NotifyOptions) => {
      const id = uid();
      const { title, action } = normalise(opts);
      setItems((cur) => [...cur, { id, tone, title, message, action }]);
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
      error: (message, opts) => push("error", message, opts),
      success: (message, opts) => push("success", message, opts),
      info: (message, opts) => push("info", message, opts),
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

const TONE_STYLE: Record<NotifyTone, { wrap: string; icon: React.ReactNode }> = {
  error: {
    wrap: "border-danger/30 bg-[color-mix(in_srgb,var(--color-danger-soft)_85%,transparent)] text-danger",
    icon: <IconAlert className="size-5 shrink-0" />,
  },
  success: {
    wrap: "border-success/30 bg-[color-mix(in_srgb,var(--color-success-soft)_85%,transparent)] text-success",
    icon: <IconCheck className="size-5 shrink-0" />,
  },
  info: {
    wrap: "border-accent/30 bg-[color-mix(in_srgb,var(--color-accent-soft)_85%,transparent)] text-accent",
    icon: <IconInfo className="size-5 shrink-0" />,
  },
};

export function NotificationBanners() {
  const tCommon = useTranslations("common");
  const list = useContext(ListCtx);
  if (!list || list.items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-[220] flex justify-center px-4 md:top-6">
      <div className="flex w-full max-w-lg flex-col gap-2">
        {list.items.map((n) => {
          const t = TONE_STYLE[n.tone];
          return (
            <div
              key={n.id}
              role={n.tone === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-panel border px-4 py-3 text-sm shadow-lg backdrop-blur-md",
                t.wrap,
              )}
            >
              {t.icon}
              <div className="min-w-0 flex-1 leading-snug">
                {n.title && <p className="font-semibold">{n.title}</p>}
                <p className={cn(n.title && "text-foreground/80")}>{n.message}</p>
                {n.action && (
                  <Link
                    href={n.action.href}
                    onClick={() => list.dismiss(n.id)}
                    className="mt-2 inline-flex h-7 items-center rounded-control border border-current/30 px-2.5 text-xs font-medium transition hover:bg-current/10"
                  >
                    {n.action.label}
                  </Link>
                )}
              </div>
              <button
                type="button"
                onClick={() => list.dismiss(n.id)}
                aria-label={tCommon("close")}
                className="-mr-1 -mt-0.5 rounded-control p-1 opacity-70 transition hover:opacity-100"
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
