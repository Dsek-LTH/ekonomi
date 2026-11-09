"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/utils";

/** How long the bar takes to come in or go. The unmount waits for it. */
const MOVE_MS = 200;

/**
 * What can be done with the rows ticked on a list, pinned to the foot of the screen while any are. Leaving,
 * it keeps the last count. Portalled to <body>: a `fixed` box inside a transform or backdrop filter (the
 * section band has one) is fixed to that.
 */
export function SelectionBar({
  count,
  label,
  children,
}: {
  /** How many rows are ticked. Zero hides the bar. */
  count: number;
  /** What the count says, given the count to say it with. */
  label: (count: number) => string;
  /** The actions, last one the main one. */
  children: React.ReactNode;
}) {
  const active = count > 0;
  // Whether the bar has risen into place (set a frame after first draw so the transition has a start).
  const [entered, setEntered] = useState(false);
  // The last count worth saying, kept through the way out and followed during render.
  const [shown, setShown] = useState(count);
  if (active && count !== shown) setShown(count);

  useEffect(() => {
    if (active) {
      const frame = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(() => setEntered(false), MOVE_MS);
    return () => clearTimeout(timer);
  }, [active]);

  // Derived from the ticks and the sink-out, not a "mounted" flag, which fell out of step.
  if (!active && !entered) return null;
  const up = active && entered;

  return createPortal(
    <div
      role="region"
      aria-label={label(shown)}
      className={cn(
        // Above the phone's tab bar (about 4rem plus the safe area), clear of the edge from md.
        "fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 flex justify-center px-4 md:bottom-6 print:hidden",
        "pointer-events-none transition-[translate,opacity] duration-200 ease-[var(--ease-out-quint)]",
        up ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      )}
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-4 rounded-panel border border-border bg-background/90 py-2 pl-4 pr-2 shadow-[var(--shadow-pop)] backdrop-blur-xl backdrop-saturate-150">
        <p aria-live="polite" className="whitespace-nowrap text-sm font-medium tabular-nums">
          {label(shown)}
        </p>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
