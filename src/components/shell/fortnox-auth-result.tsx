"use client";

// Surfaces the result of a Fortnox OAuth round-trip (?fortnox=…&reason=…), then
// strips the params so it doesn't reappear on refresh.
//
// Mounted in the app layout rather than on a page: the personal login can be
// started from anywhere (the profile menu returns you to whatever page you were
// on), so any page can be the one the callback redirects back to.
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useNotify } from "./notifications";

// The reasons the callback can send back. Anything else is a raw Fortnox error
// message, which is more useful verbatim than replaced with something generic.
const KNOWN_REASONS = ["no_service_connection", "wrong_company", "forbidden", "invalid_state"];

export function FortnoxAuthResult() {
  const t = useTranslations("fortnox.auth");
  const notify = useNotify();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const result = searchParams.get("fortnox");
  const reason = searchParams.get("reason");

  useEffect(() => {
    if (!result) return;
    if (result === "connected") notify.success(t("connected"));
    else if (result === "logged_in") notify.success(t("loggedIn"));
    else if (reason && KNOWN_REASONS.includes(reason)) notify.error(t(reason));
    else notify.error(t("failed", { reason: reason ? ` (${reason})` : "" }));
    window.history.replaceState(null, "", pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return null;
}
