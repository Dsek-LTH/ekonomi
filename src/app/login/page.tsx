"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

// Seeded local accounts, one per role, so a developer can sign in as each of
// them without Google. `role` is a key under `login.dev`.
const DEV_USERS = [
  { email: "elsa.lindqvist@user.dsek.se", name: "Elsa Lindqvist", role: "member" },
  { email: "oskar.berg@user.dsek.se", name: "Oskar Berg", role: "approver" },
  { email: "ludwig.gehlsdorf@user.dsek.se", name: "Ludwig Gehlsdorf", role: "treasurer" },
  { email: "maja.holm@user.dsek.se", name: "Maja Holm", role: "admin" },
];

export default function LoginPage() {
  const isDev = process.env.NODE_ENV !== "production";

  const t = useTranslations("login");
  const tDev = useTranslations("login.dev");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        {/* The mark stands on its own. It used to sit inside a 56px rounded
            tile with a card shadow and a white text colour, none of which had
            anything to render — an 80px symbol overflowing an empty box. */}
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

        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-border bg-background text-sm font-medium transition-colors hover:bg-surface"
        >
          <GoogleMark />
          {t("loginPrompt")}
        </button>

        {isDev && (
          <div className="mt-8 rounded-2xl border border-dashed border-border p-4 text-left">
            <p className="mb-3 text-xs font-medium text-muted">
              {tDev("heading")}
            </p>
            <div className="space-y-2">
              {DEV_USERS.map((u) => (
                <button
                  key={u.email}
                  onClick={() => signIn("dev", { email: u.email, callbackUrl: "/dashboard" })}
                  className="flex h-9 w-full items-center rounded-lg border border-border bg-background px-3 text-sm transition-colors hover:bg-surface"
                >
                  {u.name} · {tDev(u.role)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
