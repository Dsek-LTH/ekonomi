import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { THEME_COOKIE, parseTheme } from "@/lib/ui/theme";
import { cn } from "@/lib/ui/utils";
import "./globals.css";

// The tab title follows the reader's language like everything else, so it has
// to be built per request rather than exported as a constant.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("title"), description: t("description") };
}

// The visual direction, recorded where the built output can be audited against
// it. Survives the production build on purpose. Grep the emitted HTML for
// "seed aab31d9b" to confirm the contract is still shipping.
const DIRECTION_CONTRACT = `<!--
THESIS: A section's money app that looks like it belongs to the section. It refuses
the two defaults on either side: generic dashboard-blue, and a themed toy. Colour is
a system with jobs, not a skin.
OWN-WORLD: D-sektionen's pink #f280a1 as a FILL with a near-black label in both
themes; the same hue darkened to #d02253 whenever it has to be read as text; #9966cc
for the authority chain; a near-black ground carrying the violet, cards raised by
fill in dark and by hairline plus a soft offset shadow in light; system sans, tabular
figures on every number.
STORY: An ordinarie sees one pink thing per screen and it is the way forward.
Skattmästeriet sees status in colours that never lie and columns of digits that line up.
FIRST VIEWPORT: Sidebar with the section mark, page title, the primary action as the
only pink fill on the screen, dense table below with amounts right-aligned and tabular.
FORM: the category standard, taken as the standing exit over assigned direction 6
(Inbetalningskortet); mode operate, seed aab31d9b.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, and DESIGN.md
-->`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  // The theme arrives with the request, so the document is simply served in it.
  // This is the whole of the no-flash story: the class is in the markup the
  // parser reads, which is earlier than any script could run and needs no
  // `suppressHydrationWarning`, because nothing corrects the DOM afterwards.
  // See lib/ui/theme.ts for what this replaced.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang={locale} className={cn("h-full", theme === "dark" && "dark")}>
      <body className="min-h-full">
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
