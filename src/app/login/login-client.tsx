"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import type { DevUser } from "./dev-users";

export function LoginClient({
  callbackUrl,
  error,
  devUsers,
}: {
  /** Where to land after signing in. Already checked to be a local path. */
  callbackUrl: string;
  /** A key under `login.errors`, when the last attempt came back refused. */
  error: "denied" | "unknownUser" | "failed" | null;
  /** Who the dev sign-in offers. Empty in production, where there is none. */
  devUsers: DevUser[];
}) {

  const t = useTranslations("login");
  const tDev = useTranslations("login.dev");
  const tRole = useTranslations("common.role");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        {/* The mark stands on its own. It used to sit inside a 56px rounded
            tile with a card shadow and a white text colour, none of which had
            anything to render: an 80px symbol overflowing an empty box. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/symbol_rosa.svg"
          alt="D-sektionen"
          className="mx-auto mb-7 h-20 w-auto"
        />
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-[15px] text-muted">
          {t("description")}
        </p>

        {error && (
          <p
            role="alert"
            className="mx-auto mt-6 max-w-xs rounded-control border border-border px-3 py-2 text-sm"
          >
            {t(`errors.${error}`)}
          </p>
        )}

        <button
          onClick={() => signIn("authentik", { callbackUrl })}
          className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-control border border-border-control bg-background text-sm font-medium transition-colors hover:bg-hover"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/symbol_rosa.svg" alt="" aria-hidden className="h-5 w-auto" />
          {t("loginPrompt")}
        </button>

        {devUsers.length > 0 && (
          <div className="mt-8 rounded-panel border border-dashed border-border p-4 text-left">
            <p className="mb-3 text-xs font-medium text-muted">
              {tDev("heading")}
            </p>
            <div className="space-y-2">
              {devUsers.map((u) => (
                <button
                  key={u.studentId}
                  onClick={() =>
                    signIn("dev", { studentId: u.studentId, callbackUrl })
                  }
                  className="flex h-11 w-full items-center rounded-control border border-border-control bg-background px-3 text-sm transition-colors hover:bg-hover sm:h-8"
                >
                  {u.name} - {u.roles.map((r) => tRole(r)).join(", ")}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
