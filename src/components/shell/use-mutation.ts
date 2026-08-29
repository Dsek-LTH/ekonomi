"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useProgressRouter } from "./route-progress";
import { useNotify } from "./notifications";
import { apiErrorAction, resolveApiError } from "@/lib/ui/api-error";

type MutateOptions = {
  /** Marks which control is busy — compare against `pending`. Defaults to the url. */
  key?: string;
  method?: string;
  /**
   * Sent as JSON, unless it is already something the browser can send on its own
   * (a File/Blob or FormData) — those go through untouched. Omit for requests
   * without a body (DELETE, plain POST).
   */
  body?: unknown;
  /** Content-Type for a raw body. FormData sets its own, so leave it off there. */
  contentType?: string;
  /** Message key shown when the server sends no `error` code of its own. */
  error?: string;
  /** Shown on success. Omit when the caller builds its own from the response. */
  success?: string;
  /**
   * Whether a success refreshes the Server Components. On by default, because
   * that is how a screen shows what it just wrote.
   *
   * Off for a screen that already shows it: the budget sheet applies a cell edit
   * locally and re-evaluates in the browser, so a refresh per committed cell
   * would be a round trip whose whole result is data the page is already
   * displaying. Turning it off is not "skip the update" — it is "the update
   * already happened here".
   */
  refresh?: boolean;
};

const isRawBody = (b: unknown): b is BodyInit =>
  typeof Blob !== "undefined" && (b instanceof Blob || b instanceof FormData);

// The write path every client screen repeats: fire the request, surface the
// server's own error message, and refresh the Server Components on success.
//
// Returns the parsed response body, or null once a failure has been reported —
// so callers only add what's specific to them. One hook instance is one busy
// scope; take two when a screen has an action that shouldn't block the others.
//
// The response type is the caller's to name: `mutate<{ id: string }>(…)`. It
// used to be `Record<string, unknown>` for everybody, which meant every screen
// reading something back cast it — `created.id as string` — and a route that
// changed what it returned broke nothing until somebody ran it. Nothing here
// can verify the claim, so a wrong one is still wrong; what it buys is that the
// claim is written down at the call site instead of asserted mid-expression.
//
// The *request* side is named the same way, by typing the object handed to
// `body` with the route's own schema: `const patch: PatchExpense = { … }`. That
// one the compiler does check, because both sides infer from one definition in
// lib/api/schemas.
export function useMutation() {
  // Progress-aware: the refresh below is a second round trip after the request
  // itself, and until it lands the screen is still showing the old numbers. The
  // control that started the write goes idle at that point, so without the bar
  // there is a stretch where the app looks finished and isn't.
  const router = useProgressRouter();
  const notify = useNotify();
  // Un-namespaced: the server's error codes are absolute paths under `errors`.
  const t = useTranslations();
  const [pending, setPending] = useState<string | null>(null);

  // Stable identity, so `mutate` can be used from a memoised callback.
  const mutate = useCallback(
    async <T = Record<string, unknown>>(
      url: string,
      opts: MutateOptions = {},
    ): Promise<T | null> => {
      const { key = url, method = "POST", body, contentType, error, success, refresh = true } = opts;
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
          // The status is only worth showing when the server gave no reason of
          // its own — then it is the only clue anyone has.
          notify.error(
            resolveApiError(t, data) ??
              `${error ?? t("common.error.action")} (${res.status})`,
            // Some codes name somewhere to go; the banner offers it as a button
            // rather than leaving the reader to find it. Undefined for the rest,
            // which is every other failure in the app.
            { action: apiErrorAction(t, data) ?? undefined },
          );
          return null;
        }
        if (success) notify.success(success);
        if (refresh) router.refresh();
        return data as T;
      } catch {
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
