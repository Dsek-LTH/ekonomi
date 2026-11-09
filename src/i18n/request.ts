import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

// Supported UI languages. `sv` is the source of truth (all keys exist in sv/); `en` is the translation.
export const LOCALES = ["sv", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "sv";
const LOCALE_COOKIE = "NEXT_LOCALE";

// One file per top-level namespace. Listed explicitly: the import must be statically analyzable, and
// messages.test.ts needs the same list.
export const MESSAGE_NAMESPACES = [
  "common",
  "dashboard",
  "expenses",
  "mileage",
  "login",
  "errors",
  "nav",
  "allocation",
  "receipt",
  "fortnox",
  "meta",
  "book",
  "bank",
  "bookkeeping",
  "ledger",
  "budget",
  "profile",
  "faq",
  "admin",
  "errorPage",
  "income",
  "stock",
  "contracts",
  "rentals",
  "email",
  "invoices",
  "closing",
  "score",
  "guides",
  "pwa",
] as const;

const isLocale = (v: string | undefined): v is Locale =>
  !!v && (LOCALES as readonly string[]).includes(v);

// Resolve the active locale: the cookie (written by the language switcher), else Accept-Language, else the default.
async function resolveLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const accept = (await headers()).get("accept-language") ?? "";
  const preferred = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return isLocale(preferred) ? preferred : DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const modules = await Promise.all(
    MESSAGE_NAMESPACES.map((ns) => import(`../../messages/${locale}/${ns}.json`)),
  );
  const messages = Object.fromEntries(MESSAGE_NAMESPACES.map((ns, i) => [ns, modules[i].default]));
  return { locale, messages };
});
