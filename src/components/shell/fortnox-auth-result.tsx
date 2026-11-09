"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useNotify } from "./notifications";

const KNOWN_REASONS = ["no_service_connection", "wrong_company", "forbidden", "invalid_state"];

export function FortnoxAuthResult() {
  const t = useTranslations("fortnox.auth");
  const notify = useNotify();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const result = searchParams.get("fortnox");
  const reason = searchParams.get("reason");

  // The outcome already announced, so one round-trip raises one banner. Stripping the
  // params is not enough on its own: replaceState doesn't feed back into
  // useSearchParams, so a second run of this effect still sees the old `?fortnox` and
  // announces it again.
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!result) return;
    const outcome = `${result}:${reason ?? ""}`;
    if (announced.current === outcome) return;
    announced.current = outcome;

    if (result === "connected") notify.success(t("connected"));
    else if (result === "logged_in") notify.success(t("loggedIn"));
    else if (reason && KNOWN_REASONS.includes(reason)) notify.error(t(reason));
    else notify.error(t("failed", { reason: reason ? ` (${reason})` : "" }));
    window.history.replaceState(null, "", pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return null;
}
