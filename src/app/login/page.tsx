"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

// Seeded local accounts, one per role, so a developer can sign in as each of
// them without Authentik. Keyed on student id, which is what the app keys a
// user on everywhere else. `role` is a key under `login.dev`.
const DEV_USERS = [
  { studentId: "el1234li-s", name: "Elsa Lindqvist", role: "member" },
  { studentId: "os5678be-s", name: "Oskar Berg", role: "approver" },
  { studentId: "lu9012ge-s", name: "Ludwig Gehlsdorf", role: "treasurer" },
  { studentId: "ma3456ho-s", name: "Maja Holm", role: "admin" },
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

        <button
          onClick={() => signIn("authentik", { callbackUrl: "/dashboard" })}
          className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-border bg-background text-sm font-medium transition-colors hover:bg-surface"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/symbol_rosa.svg" alt="" aria-hidden className="h-5 w-auto" />
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
                  key={u.studentId}
                  onClick={() =>
                    signIn("dev", { studentId: u.studentId, callbackUrl: "/dashboard" })
                  }
                  className="flex h-11 w-full items-center rounded-lg border border-border bg-background px-3 text-sm transition-colors hover:bg-surface sm:h-9"
                >
                  {u.name} – {tDev(u.role)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
