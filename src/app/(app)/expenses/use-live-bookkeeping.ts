"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LIST_POLL_MS, type LiveBookkeeping } from "@/lib/domain/presence";

const NOTHING: LiveBookkeeping = { booking: {}, exporting: {} };

/**
 * What is happening to which utlägg right now: who else is booking one, and
 * which are locked by an export. Kept fresh while the list is on screen, and
 * asked again the moment it comes back into view. A hidden list asks nothing,
 * since nobody is reading it.
 *
 * `refresh` asks at once, for when the answer is known to have changed: an
 * export that was just refused because somebody else holds the lock.
 *
 * `enabled` false asks nothing: the Utlägg list only needs this on Alla, for
 * bookkeeping, and every other reading of it would be polling for nobody.
 */
export function useLiveBookkeeping(enabled = true): LiveBookkeeping & { refresh: () => void } {
  const [live, setLive] = useState<LiveBookkeeping>(NOTHING);
  const poll = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | null = null;

    poll.current = async () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch("/api/expenses/presence", { signal: controller.signal });
        if (res.ok) setLive(await res.json());
      } catch {
        // Aborted, or offline. The next poll asks again.
      }
    };
    const onVisibility = () => {
      if (!document.hidden) void poll.current();
    };

    // The first one from a timer as well, so no state is ever written from the
    // effect body itself (the same rule as use-query.ts).
    const first = window.setTimeout(() => void poll.current(), 0);
    const timer = window.setInterval(() => void poll.current(), LIST_POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      controller?.abort();
    };
  }, [enabled]);

  const refresh = useCallback(() => void poll.current(), []);
  return { ...live, refresh };
}
