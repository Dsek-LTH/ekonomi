import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { serverEnv } from "@/lib/server/env";
import { THEME_COOKIE, parseTheme } from "@/lib/ui/theme";
import { cn } from "@/lib/ui/utils";
import { ServiceWorker } from "@/components/pwa/service-worker";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  const locale = await getLocale();
  const title = t("title");
  const description = t("description");
  return {
    metadataBase: new URL(serverEnv("APP_URL")),
    title: { default: title, template: `%s | ${title}` },
    description,
    applicationName: title,
    appleWebApp: { capable: true, title: "Ekonomi" },
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: title,
      title,
      description,
      locale: locale === "sv" ? "sv_SE" : "en_GB",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

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

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const CANVAS = { light: "#f4f4f5", dark: "#17171a" } as const;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang={locale} className={cn("h-full", inter.variable, theme)} suppressHydrationWarning>
      <body className="min-h-full">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
