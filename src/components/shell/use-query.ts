"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { resolveApiError } from "@/lib/ui/api-error";

interface QueryOptions {
  skip?: boolean;
  debounceMs?: number;
  error?: string;
  keepPrevious?: boolean;
}

interface Query<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useQuery<T>(url: string | null, opts: QueryOptions = {}): Query<T> {
  const { skip = false, debounceMs = 0, error: errorKey, keepPrevious = true } = opts;
  const t = useTranslations();

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

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
          setError(
            resolveApiError(t, json) ??
              `${errorKey ? t(errorKey) : t("common.error.action")} (${res.status})`,
          );
          setData(null);
          return;
        }
        setData(json as T);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setError(t("common.error.network"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

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
