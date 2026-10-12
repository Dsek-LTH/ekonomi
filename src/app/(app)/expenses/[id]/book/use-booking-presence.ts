"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HEARTBEAT_MS,
  isIdle,
  type PresenceAnswer,
  type PresentUser,
} from "@/lib/domain/presence";

// Activity that means somebody is at this screen. Listened to in the capture
// phase, so a control that stops propagation still counts.
const ACTIVITY = ["pointerdown", "keydown", "input", "wheel", "focus"] as const;

/**
 * The booking screen's side of presence: say that we are here, learn who else
 * is, and notice when somebody saved the utlägg underneath us.
 *
 * `expenseId` is null when there is nothing to announce (no utlägg, nothing
 * bookable about it, or a viewer who may not book), and then this does nothing.
 * `loadedUpdatedAt` is the version the screen was rendered from.
 *
 * Every way out takes the user off a colleague's screen, and none of them
 * depends on the others:
 *   - leaving the page sends a DELETE (with `keepalive`, so it survives the tab
 *     closing);
 *   - going idle, or leaving the tab hidden, makes the heartbeat say so, and the
 *     server drops the row;
 *   - a crash or a dropped network stops the heartbeats, and the server stops
 *     counting the row once the TTL runs out.
 * A heartbeat already on the wire when the DELETE goes out can land after it
 * and put the row back. The TTL takes it off again, and nothing waits on it.
 */
export function useBookingPresence(expenseId: string | null, loadedUpdatedAt: string | null) {
  const [others, setOthers] = useState<PresentUser[]>([]);
  // Set once the utlägg has moved on from the version on screen. `by` is whoever
  // acted on it last, when the server knows.
  const [stale, setStale] = useState<{ by?: PresentUser } | null>(null);

  // Our own save is in flight. Its answer will carry a new version, and a
  // heartbeat that read it first would report our own write as somebody else's.
  const paused = useRef(false);
  // The server said we may not be here (signed out, role gone, utlägg gone).
  // Asking again every ten seconds would not change its mind.
  const stopped = useRef(false);
  const lastActivity = useRef(0);
  const hiddenSince = useRef<number | null>(null);
  const wasIdle = useRef(false);
  const inFlight = useRef<AbortController | null>(null);

  const url = expenseId ? `/api/expenses/${expenseId}/presence` : null;

  const beat = useCallback(async () => {
    if (!url || stopped.current || paused.current) return;
    const active = !isIdle(Date.now(), lastActivity.current, hiddenSince.current);
    wasIdle.current = !active;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        stopped.current = true;
        setOthers([]);
        return;
      }
      if (!res.ok || paused.current) return;
      const answer = (await res.json()) as PresenceAnswer;
      if (paused.current) return;
      setOthers(answer.others);
      if (loadedUpdatedAt && answer.updatedAt !== loadedUpdatedAt) {
        setStale({ by: answer.updatedBy });
      }
    } catch {
      // Aborted, or offline. The next heartbeat asks again.
    }
  }, [url, loadedUpdatedAt]);

  useEffect(() => {
    if (!url) return;
    lastActivity.current = Date.now();
    hiddenSince.current = document.hidden ? Date.now() : null;

    const onActivity = () => {
      lastActivity.current = Date.now();
      // Back from idle: say so now, not at the next tick.
      if (wasIdle.current) void beat();
    };
    const onVisibility = () => {
      if (document.hidden) {
        hiddenSince.current = Date.now();
        return;
      }
      hiddenSince.current = null;
      // Coming back to the tab is activity, and the moment most worth knowing
      // whether somebody saved while it was in the background.
      lastActivity.current = Date.now();
      void beat();
    };
    const goodbye = () => {
      fetch(url, { method: "DELETE", keepalive: true }).catch(() => {});
    };
    // Back out of the bfcache after a `pagehide` said goodbye.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void beat();
    };

    // The first one from a timer as well, so no state is ever written from the
    // effect body itself (the same rule as use-query.ts).
    const first = window.setTimeout(() => void beat(), 0);
    const timer = window.setInterval(() => void beat(), HEARTBEAT_MS);
    for (const type of ACTIVITY) {
      window.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", goodbye);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      for (const type of ACTIVITY) {
        window.removeEventListener(type, onActivity, { capture: true });
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", goodbye);
      window.removeEventListener("pageshow", onPageShow);
      inFlight.current?.abort();
      goodbye();
    };
  }, [url, beat]);

  /** Our own save is about to change the version. Ignore heartbeats until it settles. */
  const pause = useCallback(() => {
    paused.current = true;
    inFlight.current?.abort();
  }, []);

  /** The save failed. Listen again, and ask straight away: it may have failed
   *  because somebody else got there first. */
  const resume = useCallback(() => {
    paused.current = false;
    void beat();
  }, [beat]);

  return { others, stale, pause, resume };
}
