"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { resolveApiError } from "@/lib/ui/api-error";

// The read path, the counterpart to use-mutation.ts.
//
// `useMutation` had covered writing since early on, so every write in the app
// reports failures the same way. Reading had nothing, and six screens had each
// invented it: loading state, error state, and a guard against a slow response
// landing after a fast one. Three different guards, in fact. The ledger screen
// counted requests in a ref, the user screens used an AbortController, and the
// ledger's own drill-down had neither, so two quick clicks on different
// accounts could put the wrong rows under the wrong one.
//
// One guard here, and it is the AbortController: a counter ignores the stale
// answer, an abort means the browser never finishes fetching it.
//
// Errors are worded the same way `useMutation` words them, through
// `resolveApiError`, because a route answers a GET and a POST with the same
// `{ error }` shape and a reader should not be able to tell which of the two
// failed by how the message reads.

interface QueryOptions {
  /**
   * Don't fetch yet. For a query that has no url to build until something is
   * chosen, or a panel that only loads once it is looked at.
   */
  skip?: boolean;
  /** Wait this long after `url` last changed. For a search box. */
  debounceMs?: number;
  /** Message key shown when the server sends no `error` code of its own. */
  error?: string;
  /**
   * Keep the previous data on screen while the next request is in flight.
   *
   * On by default: a table that blanks itself on every filter change flashes,
   * and the reader has nothing to compare the new figures against. `loading`
   * is what says a request is running.
   */
  keepPrevious?: boolean;
}

export interface Query<T> {
  data: T | null;
  loading: boolean;
  /** The failure, already worded in the reader's language. */
  error: string | null;
  /** Ask again, for a retry button or after a write that changed the answer. */
  reload: () => void;
}

export function useQuery<T>(url: string | null, opts: QueryOptions = {}): Query<T> {
  const { skip = false, debounceMs = 0, error: errorKey, keepPrevious = true } = opts;
  const t = useTranslations();

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped to re-run the effect without changing the url.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // The request in flight, so a new one can call it off. Held in a ref rather
  // than in state: aborting is not something the screen renders.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (skip || url === null) return;

    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;

    const run = async () => {
      setLoading(true);
      setError(null);
      if (!keepPrevious) setData(null);
      try {
        const res = await fetch(url, { signal: controller.signal });
        const json = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok) {
          // Through `resolveApiError`, not `json.error` raw: that field carries
          // a message *code*, and printing it put "auth.signedOut" on screen.
          setError(
            resolveApiError(t, json) ??
              `${errorKey ? t(errorKey) : t("common.error.action")} (${res.status})`,
          );
          setData(null);
          return;
        }
        setData(json as T);
      } catch (e) {
        // An abort is this hook calling off its own request, not a failure the
        // reader has any business being told about.
        if ((e as Error)?.name === "AbortError") return;
        setError(t("common.error.network"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    // Every state write happens inside the timer or the promise, never in the
    // effect body, so a keystroke costs one render rather than three.
    const timer = debounceMs ? setTimeout(run, debounceMs) : undefined;
    if (!timer) void run();

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `t` is stable per locale; including it would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, skip, debounceMs, nonce]);

  return { data, loading, error, reload };
}
