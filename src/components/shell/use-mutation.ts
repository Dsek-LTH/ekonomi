"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useProgressRouter } from "./route-progress";
import { useNotify } from "./notifications";
import { apiErrorAction, resolveApiError } from "@/lib/ui/api-error";

type MutateOptions = {
  key?: string;
  method?: string;
  body?: unknown;
  contentType?: string;
  error?: string;
  success?: string;
  refresh?: boolean;
  onError?: (message: string) => void;
};

const isRawBody = (b: unknown): b is BodyInit =>
  typeof Blob !== "undefined" && (b instanceof Blob || b instanceof FormData);

export function useMutation() {
  const router = useProgressRouter();
  const notify = useNotify();
  const t = useTranslations();
  const [pending, setPending] = useState<string | null>(null);

  const mutate = useCallback(
    async <T = Record<string, unknown>>(
      url: string,
      opts: MutateOptions = {},
    ): Promise<T | null> => {
      const {
        key = url,
        method = "POST",
        body,
        contentType,
        error,
        success,
        refresh = true,
        onError,
      } = opts;
      const raw = isRawBody(body);
      const type = raw ? contentType : body === undefined ? undefined : "application/json";
      setPending(key);
      try {
        const res = await fetch(url, {
          method,
          headers: type ? { "Content-Type": type } : undefined,
          body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message =
            resolveApiError(t, data) ?? `${error ?? t("common.error.action")} (${res.status})`;
          onError?.(message);
          notify.error(message, { action: apiErrorAction(t, data) ?? undefined });
          return null;
        }
        if (success) notify.success(success);
        if (refresh) router.refresh();
        return data as T;
      } catch {
        onError?.(t("common.error.network"));
        notify.error(t("common.error.network"));
        return null;
      } finally {
        setPending(null);
      }
    },
    [notify, router, t],
  );

  return { pending, busy: pending !== null, mutate };
}
