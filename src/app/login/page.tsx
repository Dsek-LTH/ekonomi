import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadUser, resolveUserId } from "@/lib/server/current-user";
import { getDevUsers } from "./dev-users";
import { LoginClient } from "./login-client";

type SearchParams = { [key: string]: string | string[] | undefined };

// The one public page, so the one page that asks to be indexed. The canonical
// drops ?callbackUrl and ?error, so every variant counts as the same page.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return {
    title: { absolute: t("title") },
    description: t("seoDescription"),
    alternates: { canonical: "/login" },
    robots: { index: true, follow: false },
  };
}

/**
 * A path on this site, or the dashboard. Only a single leading slash passes:
 * `//evil.example` is a path to a browser and a host to everyone else.
 */
function localPath(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/dashboard";
}

// Auth.js sends a refused sign-in back here as `?error=<type>`. Only two of its
// types say something the reader can act on. Everything else is our side.
function errorKey(value: string | string[] | undefined) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  if (v === "AccessDenied") return "denied";
  if (v === "CredentialsSignin") return "unknownUser";
  return "failed";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const callbackUrl = localPath(params.callbackUrl);

  // Already signed in: go where the sign-in would have gone. Asks for the row
  // and not just the token, the same question `requireUser` asks, or a token
  // whose user was deleted would bounce between here and the dashboard.
  const id = await resolveUserId();
  if (id && (await loadUser(id))) redirect(callbackUrl);

  return (
    <LoginClient
      callbackUrl={callbackUrl}
      error={errorKey(params.error)}
      devUsers={await getDevUsers()}
    />
  );
}
