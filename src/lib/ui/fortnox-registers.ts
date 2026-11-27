"use client";

// A picker that lists a Fortnox register live (suppliers at kontering, customers on the board's invoices) is read once
// when its page opens. A supplier is added in Fortnox, in another tab, and then perhaps synced in the settings over
// this page. Either way the picker kept its old list until the page was reloaded. These two let it read the register
// again when that happens.

import { useEffect, useRef } from "react";

const CHANNEL = "fortnox-registers";

/** Say that a register was synced from Fortnox. Heard in this tab and every other one. */
export function announceRegistersSynced(): void {
  if (typeof BroadcastChannel === "undefined") return;
  // A channel does not hear its own messages, so a fresh one sends: the listeners in this tab hear it too.
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage("synced");
  channel.close();
}

/** Run `reload` after a sync (announceRegistersSynced), and when the tab is shown again (back from Fortnox). */
export function useReloadOnRegisterChange(reload: () => void): void {
  const ref = useRef(reload);
  useEffect(() => {
    ref.current = reload;
  });
  useEffect(() => {
    const run = () => ref.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    channel?.addEventListener("message", run);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      channel?.close();
    };
  }, []);
}
