import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type sv from "../../../messages/sv/meta.json";

export type PageTitle = keyof (typeof sv)["titles"];

/**
 * A page's tab title, in the reader's language. The root layout's template
 * appends the app name, so a tab reads "Utlägg | D-sektionen | Ekonomi".
 * Used as `export const generateMetadata = titled("expenses");`.
 */
export function titled(key: PageTitle) {
  return async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("meta.titles");
    return { title: t(key) };
  };
}
