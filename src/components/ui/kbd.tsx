"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/ui/utils";

/** Whether this is an Apple device, where the shortcut key is ⌘ rather than Ctrl. */
function useApple(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => true,
  );
}

/** A keyboard shortcut as a key cap: `mod` is ⌘ on an Apple device and Ctrl elsewhere. */
export function Kbd({ mod, k, className }: { mod?: boolean; k: string; className?: string }) {
  const apple = useApple();
  const label = mod ? (apple ? `⌘${k}` : `Ctrl+${k}`) : k;
  return (
    <kbd
      className={cn(
        "inline-flex h-6 items-center rounded-control border border-border-control bg-surface px-1.5 font-sans text-xs font-medium text-muted",
        className,
      )}
    >
      {label}
    </kbd>
  );
}
