"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const BACKGROUND = "/dashboard";

let pending: string | null = null;

export function SettingsBounce() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    // Strict mode runs this twice, and the second run must not replace the dashboard
    // again.
    if (pending) return;
    pending = search ? `${pathname}?${search}` : pathname;
    router.replace(BACKGROUND);
  }, [router, pathname, search]);

  return null;
}

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
