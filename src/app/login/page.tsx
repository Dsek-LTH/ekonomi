import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadUser, resolveUserId } from "@/lib/server/current-user";
import { getDevUsers } from "./dev-users";
import { LoginClient } from "./login-client";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return {
    title: { absolute: t("title") },
    description: t("seoDescription"),
    alternates: { canonical: "/login" },
    robots: { index: true, follow: false },
  };
}

function localPath(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/dashboard";
}

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
