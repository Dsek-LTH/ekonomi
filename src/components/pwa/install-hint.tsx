"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { IconDownload, IconShare, IconX } from "@/components/ui/icons";
import { usePlatform } from "./platform";
import { promptInstall, useCanPromptInstall } from "./service-worker";

// Android: service-worker.tsx holds Chrome's install banner back so this card makes the offer.
// An iPhone only has the share sheet's "Lägg till på hemskärmen".

const DISMISSED_KEY = "pwa:install-hint:dismissed";

function readDismissed(): boolean {
  // Storage can be missing or throw (private mode, blocked site data): then the card shows.
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

// Read after hydration only: the server draws nothing.
const never = () => () => {};

export function InstallHint() {
  const t = useTranslations("pwa");
  const platform = usePlatform();
  const stored = useSyncExternalStore(never, readDismissed, () => true);
  const [closed, setClosed] = useState(false);
  const canPrompt = useCanPromptInstall();

  if (platform === "installed" || platform === "other" || stored || closed) return null;

  function dismiss() {
    setClosed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {}
  }

  return (
    <Card className="flex items-start gap-3 p-4 md:hidden">
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium">{t("title")}</p>
        <p className="text-muted">
          {platform === "ios"
            ? t.rich("ios", {
                share: () => <IconShare className="inline size-4 align-text-bottom" />,
                b: (c) => <span className="font-medium text-foreground">{c}</span>,
              })
            : canPrompt
              ? t("android")
              : t.rich("androidMenu", {
                  b: (c) => <span className="font-medium text-foreground">{c}</span>,
                })}
        </p>
        {platform === "android" && canPrompt && (
          <Button className="mt-2" onClick={() => void promptInstall()}>
            <IconDownload className="size-4" />
            {t("install")}
          </Button>
        )}
      </div>
      <IconButton label={t("dismiss")} onClick={dismiss} className="-mr-1 -mt-1">
        <IconX className="size-4" />
      </IconButton>
    </Card>
  );
}
