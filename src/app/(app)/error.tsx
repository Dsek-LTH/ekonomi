"use client";

// What a signed-in member sees when a page throws. Inside `(app)` so the shell stays up. Says nothing about
// the cause (redacted in production); the digest ties a report to the server log.

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

  // The server has already logged this.
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
            <Button onClick={reset}>{t("retry")}</Button>
            <ButtonLink href="/dashboard" variant="secondary">
              {t("home")}
            </ButtonLink>
          </div>
        }
      />
      {error.digest && (
        <p className="text-center text-xs text-muted">{t("digest", { digest: error.digest })}</p>
      )}
    </div>
  );
}
