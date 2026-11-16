"use client";

// Asks before leaving a page with unsaved work: closing or reloading the tab (the browser's own
// prompt) and following a link inside the app (our confirm dialog). The browser's Back button is
// not caught, since the app router gives no way to hold it.
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/components/confirm-dialog";
import { useProgressRouter } from "@/components/shell/route-progress";

export function useLeaveGuard(dirty: boolean) {
  const t = useTranslations("common.leaveGuard");
  const confirm = useConfirm();
  const router = useProgressRouter();

  useEffect(() => {
    if (!dirty) return;

    const unload = (e: BeforeUnloadEvent) => e.preventDefault();

    // Capture phase on the document, so it runs before the router's own handler on the link.
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || a.hasAttribute("download"))
        return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;

      e.preventDefault();
      e.stopPropagation();
      void confirm({
        title: t("title"),
        message: t("message"),
        confirmLabel: t("leave"),
        tone: "danger",
      }).then((ok) => {
        if (ok) router.push(url.pathname + url.search + url.hash);
      });
    };

    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, confirm, router, t]);
}
