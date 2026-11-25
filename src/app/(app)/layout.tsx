import { Suspense } from "react";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { RouteHistoryRecorder } from "@/components/shell/route-history";
import { SettingsReopener } from "@/components/shell/settings-bounce";
import { RouteProgressBar } from "@/components/shell/route-progress";
import { ReceiptPanelProvider } from "@/components/receipt/receipt-panel";
import {
  receiptWidthFrom,
  RECEIPT_COLLAPSED_COOKIE,
  RECEIPT_WIDTH_COOKIE,
} from "@/lib/ui/receipt-panel-cookies";
import { RoleProvider } from "@/components/shell/role-context";
import { NotificationBanners, NotificationsProvider } from "@/components/shell/notifications";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { FortnoxAuthResult } from "@/components/shell/fortnox-auth-result";
import { requireUser } from "@/lib/server/current-user";
import { getAvatarVersions, getSeenGuideSteps, userHoldsCard } from "@/lib/data/users";
import { GuideProvider } from "@/components/shell/guide";
import { AvatarProvider } from "@/components/ui/avatar";
import { getFortnoxCompany, getFortnoxSession } from "@/lib/data/fortnox";
import { getNavCounts, navCountsByHref } from "@/lib/data/nav-counts";
import { getFiscalYear, getFiscalYears } from "@/lib/server/fiscal-year";
import { canLogInToFortnox } from "@/lib/domain/permissions";

// Always render against fresh DB data. Each page loads its own data; the layout resolves the user and chrome.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  /** The `@modal` parallel slot: settings, intercepted. Null unless a client-side navigation into /admin. */
  modal: React.ReactNode;
}) {
  const currentUser = await requireUser();

  // The treasury's Fortnox login is short-lived (see FortnoxStatus), so the frame carries whether it still holds.
  const booksInFortnox = canLogInToFortnox(currentUser.capabilities);
  const [
    holdsCard,
    fortnoxSession,
    fortnoxCompany,
    cookieStore,
    counts,
    fiscalYears,
    fiscalYear,
    avatars,
    guides,
  ] = await Promise.all([
    userHoldsCard(currentUser.id),
    booksInFortnox ? getFortnoxSession(currentUser.id) : null,
    booksInFortnox ? getFortnoxCompany() : null,
    cookies(),
    // Counts for the nav's links, in the header's year.
    getFiscalYear().then((year) => getNavCounts(currentUser, year)),
    // The header's räkenskapsår (cached per request, see lib/server/fiscal-year.ts).
    getFiscalYears(),
    getFiscalYear(),
    // Who has a profile picture (components/ui/avatar.tsx).
    getAvatarVersions(),
    // Guide steps already shown (components/shell/guide.tsx).
    getSeenGuideSteps(currentUser.id),
  ]);
  // Read here so the frame renders in its stored shape on first paint.
  const receiptCollapsed = cookieStore.get(RECEIPT_COLLAPSED_COOKIE)?.value === "1";
  const receiptWidth = receiptWidthFrom(cookieStore.get(RECEIPT_WIDTH_COOKIE)?.value);

  return (
    <RoleProvider user={{ ...currentUser, holdsCard }}>
      <AvatarProvider versions={avatars}>
        <NotificationsProvider>
          <ConfirmProvider>
            <FortnoxAuthResult />
            <Suspense fallback={null}>
              <RouteProgressBar />
              <RouteHistoryRecorder />
              <SettingsReopener />
            </Suspense>
            <NotificationBanners />
            <ReceiptPanelProvider defaultCollapsed={receiptCollapsed} defaultWidth={receiptWidth}>
              <GuideProvider seen={guides}>
                <AppShell
                  fortnox={
                    booksInFortnox
                      ? { session: fortnoxSession, company: fortnoxCompany }
                      : undefined
                  }
                  fiscal={fiscalYear && { years: fiscalYears, selected: fiscalYear }}
                  counts={navCountsByHref(counts)}
                >
                  {children}
                </AppShell>
                {modal}
              </GuideProvider>
            </ReceiptPanelProvider>
          </ConfirmProvider>
        </NotificationsProvider>
      </AvatarProvider>
    </RoleProvider>
  );
}
