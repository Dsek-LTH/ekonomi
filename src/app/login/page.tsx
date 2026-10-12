import { redirect } from "next/navigation";
import { loadUser, resolveUserId } from "@/lib/server/current-user";
import { LoginClient } from "./login-client";

type SearchParams = { [key: string]: string | string[] | undefined };

/**
 * A path on this site, or the dashboard. Only a single leading slash passes:
 * `//evil.example` is a path to a browser and a host to everyone else.
 */
function localPath(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\")
    ? v
    : "/dashboard";
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

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const callbackUrl = localPath(params.callbackUrl);

  // Already signed in: go where the sign-in would have gone. Asks for the row
  // and not just the token, the same question `requireUser` asks, or a token
  // whose user was deleted would bounce between here and the dashboard.
  const id = await resolveUserId();
  if (id && (await loadUser(id))) redirect(callbackUrl);

  return <LoginClient callbackUrl={callbackUrl} error={errorKey(params.error)} />;
}
