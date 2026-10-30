import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
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

/**
 * What the browser paints its own chrome in: the address bar on Android, the
 * status bar area of an installed PWA, the strip either side of the page.
 *
 * There was none of this at all, so a dark app sat inside a white browser. It
 * is a `generateViewport` rather than a constant because the answer is the
 * reader's stored choice where they have made one, and only where they have not
 * does it fall back to the pair the OS picks between. The colours are
 * `--color-canvas` in each theme, the ground the page itself is on, so the
 * chrome continues the page instead of framing it.
 *
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` mean anything.
 * Every bar fixed to the foot of a phone (the tab bar, the action bar, the
 * sheets) pads itself by `safe-area-inset-bottom`, and without it iOS reports
 * every inset as nought: the tab bar sat under the home indicator and Safari's
 * floating toolbar on a recent iPhone.
 */
export async function generateViewport(): Promise<Viewport> {
  const choice = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  if (choice) return { viewportFit: "cover", themeColor: CANVAS[choice] };
  return {
    viewportFit: "cover",
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: CANVAS.light },
      { media: "(prefers-color-scheme: dark)", color: CANVAS.dark },
    ],
  };
}

// Self-hosted at build time by next/font, so no request leaves for Google at
// runtime. Exposed as a variable rather than a class: --font-sans in
// globals.css puts it first and keeps the system stack behind it.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

/** `--color-canvas` in both themes. The one pair of values that has to exist
 *  outside globals.css, because a <meta> tag cannot read a custom property. */
const CANVAS = { light: "#f4f4f5", dark: "#17171a" } as const;

// The visual direction, recorded where the built output can be audited against
// it. Survives the production build on purpose. Grep the emitted HTML for
// "seed aab31d9b" to confirm the contract is still shipping.
//
// Every hex in it is a token in app/globals.css and has to keep saying what the
// token says. The tokens are the record and this follows them.
const DIRECTION_CONTRACT = `<!--
THESIS: A section's money app that reads as a finance tool. It refuses the two
defaults on either side: generic dashboard-blue, and a themed toy. Colour is a system
with jobs, not a skin.
OWN-WORLD: D-sektionen's pink #f280a1 as the one action fill, in a flat blend with a
white label, and for the current page, scope and tab and the first chart series;
ink #18181b for the accent and links (inverted in dark);
#8b5fc7 for a budget's standing (locked, adopted); cards drawn by hairline alone;
Inter, tabular figures on every number.
STORY: An ordinarie sees one filled button per screen and it is the way forward.
Skattmästeriet sees status in colours that never lie and columns of digits that line up.
FIRST VIEWPORT: Header with the section mark, page title, the primary action as the
only filled button on the screen, dense table below with amounts right-aligned and tabular.
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
    // No class at all when the reader has never chosen, which is what hands the
    // question to `prefers-color-scheme` in globals.css. An explicit light is a
    // class of its own and not the absence of `dark`: on a machine set to dark
    // those are two different documents. See lib/ui/theme.ts.
    //
    // suppressHydrationWarning because browser extensions write attributes onto
    // <html> before React hydrates (one leaves `__gcrremoteframetoken`), and each
    // of them was a hydration error in dev. It covers this element's own
    // attributes and nothing below it. The theme class is rendered here from the
    // cookie, so there is no difference of our own for it to hide.
    <html lang={locale} className={cn("h-full", inter.variable, theme)} suppressHydrationWarning>
      <body className="min-h-full">
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
