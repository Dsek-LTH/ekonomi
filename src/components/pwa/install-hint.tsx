"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { IconDownload, IconShare, IconX } from "@/components/ui/icons";
import { usePlatform } from "./platform";
import { promptInstall, useCanPromptInstall } from "./service-worker";

// A card on a phone that says the app can be put on the home screen, and how.
// Gone once it is installed, and for good once it is closed.
//
// An iPhone never offers to install a site by itself: it is the share sheet's
// "Lägg till på hemskärmen", and nobody looks for it there unless told. Android
// does offer, and the card is where that offer is made (service-worker.tsx
// holds Chrome's own banner back for it). When Chrome has not offered (it
// decides for itself when), the card says where the same thing is in its menu.

const DISMISSED_KEY = "pwa:install-hint:dismissed";

function readDismissed(): boolean {
  // Storage can be missing or throw (private mode, blocked site data). Then
  // the card shows, and closing it lasts until the page is left.
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

// Closing it is remembered in storage, which does not change while the page is
// open, so there is nothing to subscribe to. Read after hydration only: on the
// server the card is not drawn at all, and the client does not disagree.
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
    } catch {
      // Closed for this visit only. See readDismissed.
    }
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
