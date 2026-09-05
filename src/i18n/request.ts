import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

// Supported UI languages. `sv` is the source-of-truth locale (all keys exist in
// sv.json); `en` is the translation.
export const LOCALES = ["sv", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "sv";
const LOCALE_COOKIE = "NEXT_LOCALE";

const isLocale = (v: string | undefined): v is Locale =>
  !!v && (LOCALES as readonly string[]).includes(v);

// Resolve the active locale for a request. The cookie is canonical at runtime,
// the language switcher writes it. Without a cookie we fall back to the
// browser's Accept-Language, then to the default.
async function resolveLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const accept = (await headers()).get("accept-language") ?? "";
  const preferred = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return isLocale(preferred) ? preferred : DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
