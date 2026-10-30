"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/utils";

/** How long the bar takes to come in or go. The unmount waits for it. */
const MOVE_MS = 200;

/**
 * What can be done with the rows ticked on a list, pinned to the foot of the
 * screen while any are, and gone the moment none are.
 *
 * At the foot rather than on the toolbar: the toolbar is what the list is
 * (search, filters, the page's own action), and a button that only exists
 * while rows are ticked made it change shape under the reader's hand. Down
 * here it is in reach of the rows that were just ticked, and costs no room the
 * rest of the time.
 *
 * It rises in and sinks out rather than appearing, so it reads as having come
 * from the ticking. Leaving, it keeps the last count it showed, so it does not
 * say "0 valda" on its way out. `prefers-reduced-motion` is answered by the
 * blunt rule in globals.css: it simply arrives.
 *
 * Portalled to <body>: a `fixed` box inside anything with a transform or a
 * backdrop filter (the section band has one) is fixed to that, not to the
 * screen.
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
  // Whether the bar has risen into place. Set a frame after it is first drawn
  // (at rest below the edge, so the transition has a start to move from) and
  // cleared once it has sunk out again, which is also when it unmounts.
  const [entered, setEntered] = useState(false);
  // The last count worth saying, kept through the way out so the bar does not
  // read "0 valda" as it goes. Followed during render: it is a value derived
  // from the props, and a render-phase update is how React keeps one.
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

  // Drawn while ticked, and while it is still sinking out after. Derived from
  // the two rather than kept as a "mounted" flag of its own, which fell out of
  // step with the ticks and left the bar hidden while rows were ticked.
  if (!active && !entered) return null;
  const up = active && entered;

  return createPortal(
    <div
      role="region"
      aria-label={label(shown)}
      className={cn(
        // Above the phone's tab bar, which is about 4rem plus the safe area,
        // and clear of the screen's edge from md, where there is none.
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
