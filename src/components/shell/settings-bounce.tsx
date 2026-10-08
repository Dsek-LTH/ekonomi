"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Settings only exist as the overlay in @modal/(.)admin. That route is an
// intercepting one, so it only catches a client-side navigation. A reload, a
// new tab or the Fortnox login sending you back to /admin/fortnox all load
// /admin itself, which used to render settings as a page of its own.
//
// So /admin, loaded directly, does not render. It replaces itself with the
// dashboard and asks for the same URL again once the dashboard is there. That
// second navigation is client-side, the interception catches it, and settings
// open as the overlay over the dashboard. Closing it goes back to the
// dashboard.

const BACKGROUND = "/dashboard";

// Held between the two navigations. Module state, because the component that
// sets it is unmounted by the first of them.
let pending: string | null = null;

/** /admin's own layout. Renders nothing and sends you round to the overlay. */
export function SettingsBounce() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    // Set once. Strict mode runs this twice, and the second run must not
    // replace the dashboard again.
    if (pending) return;
    pending = search ? `${pathname}?${search}` : pathname;
    router.replace(BACKGROUND);
  }, [router, pathname, search]);

  return null;
}

/**
 * Mounted once in the app layout. When the dashboard has landed with a settings
 * URL waiting, opens it. A push, so the overlay is one history entry above the
 * dashboard and Back closes it.
 */
export function SettingsReopener() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== BACKGROUND || !pending) return;
    const url = pending;
    pending = null;
    router.push(url);
  }, [router, pathname]);

  return null;
}
