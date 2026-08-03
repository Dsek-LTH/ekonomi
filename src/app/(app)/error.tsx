"use client";

// What a signed-in member sees when a page throws.
//
// Every route in the app has a `loading.tsx` that mirrors the shape of what is
// arriving; this is the other half of that promise, and it was missing — a
// throw in a Server Component fell through to Next's stock error page, with no
// sidebar, no language and no way back. Sitting inside `(app)` means the shell
// stays up: the nav is still there, so the failure is one page rather than the
// whole app.
//
// Deliberately says nothing about what went wrong. `error.message` from a
// Server Component is redacted in production anyway, and the parts that aren't
// (a Prisma message, a stack) are not this reader's business — the digest is
// what ties a report to the server log.

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPage");

  // The server has already logged this; the browser console is for whoever is
  // sitting in front of the failure with devtools open.
  useEffect(() => {
    console.error("[app] page failed", error);
  }, [error]);

  return (
    <div className="space-y-4">
      <EmptyState
        title={t("title")}
        description={t("description")}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {/* Retrying is the first thing worth offering: most of what reaches
                here is a database or Fortnox hiccup that is over by the time
                anyone has read the message. */}
            <Button onClick={reset}>{t("retry")}</Button>
            <ButtonLink href="/dashboard" variant="secondary">
              {t("home")}
            </ButtonLink>
          </div>
        }
      />
      {/* The one string worth showing: it is what lets someone say *which*
          failure they hit, and it means nothing without the server log. */}
      {error.digest && (
        <p className="text-center text-xs text-muted">
          {t("digest", { digest: error.digest })}
        </p>
      )}
    </div>
  );
}
