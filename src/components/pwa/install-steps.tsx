"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { IconDots, IconDownload, IconShare } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";
import type { Platform } from "./platform";
import { promptInstall, useCanPromptInstall } from "./service-worker";

// How to put the app on the home screen, step by step, for the first card of
// the app tour on a phone (shell/guide.tsx). The dashboard's own card
// (install-hint.tsx) says the same in a sentence. Here there is room to number
// the taps, which is what someone holding the phone in the other hand follows.

const IOS = ["steps.ios1", "steps.ios2", "steps.ios3"] as const;
const ANDROID = ["steps.android1", "steps.android2"] as const;

export function InstallSteps({ platform }: { platform: Platform }) {
  const t = useTranslations("pwa");
  const canPrompt = useCanPromptInstall();

  // Android offering an install of its own: one button does it all.
  if (platform === "android" && canPrompt) {
    return (
      <Button className="mt-3 w-full" onClick={() => void promptInstall()}>
        <IconDownload className="size-4" />
        {t("install")}
      </Button>
    );
  }

  const keys = platform === "ios" ? IOS : ANDROID;
  const b = (c: React.ReactNode) => <span className="font-medium">{c}</span>;
  return (
    <ol className="mt-3 space-y-2.5">
      {keys.map((key, i) => (
        <li key={key} className="flex items-start gap-3 text-sm">
          <StepNumber n={i + 1} />
          <span className="min-w-0 pt-0.5">
            {t.rich(key, {
              b,
              share: () => <IconShare className="inline size-4 align-text-bottom" />,
              dots: () => <IconDots className="inline size-4 rotate-90 align-text-bottom" />,
            })}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A step's number in a pink circle, the brand's action colour. Also the
 * dashboard's first-run steps, at the larger size. A size rather than a
 * className, since `cn` joins rather than merges and two `size-` utilities
 * would be settled by stylesheet order.
 */
export function StepNumber({ n, size = "sm" }: { n: number; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "action-fill flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums text-white",
        size === "md" ? "mt-0.5 size-7 text-[13px]" : "size-6 text-xs",
      )}
    >
      {n}
    </span>
  );
}
