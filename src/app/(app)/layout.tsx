import { Suspense } from "react";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { RouteHistoryRecorder } from "@/components/shell/route-history";
import { SettingsReopener } from "@/components/shell/settings-bounce";
import { RouteProgressBar } from "@/components/shell/route-progress";
import {
  DEFAULT_WIDTH,
  RECEIPT_COLLAPSED_COOKIE,
  RECEIPT_WIDTH_COOKIE,
  ReceiptPanelProvider,
} from "@/components/receipt/receipt-panel";
import { RoleProvider } from "@/components/shell/role-context";
import { NotificationBanners, NotificationsProvider } from "@/components/shell/notifications";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { FortnoxAuthResult } from "@/components/shell/fortnox-auth-result";
import { requireUser } from "@/lib/server/current-user";
import { userHoldsCard } from "@/lib/data/users";
import { getFortnoxSession } from "@/lib/data/fortnox";
import { getNavCounts } from "@/lib/data/nav-counts";
import { getFiscalYear, getFiscalYears } from "@/lib/server/fiscal-year";
import { canLogInToFortnox } from "@/lib/domain/permissions";

// Always render against fresh DB data on a full load. Each page loads its own
// data (Server Components); the layout only resolves the session user + chrome.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  /** The `@modal` parallel slot: settings, intercepted. Null on every route
   *  that isn't a client-side navigation into /admin. See @modal/default.tsx
   *  and @modal/(.)admin. */
  modal: React.ReactNode;
}) {
  const currentUser = await requireUser();

  // The treasury books under their own Fortnox login, and that login is
  // short-lived by design (see FortnoxStatus), so whether it still holds is
  // something the frame carries for them, not something they go to /profile to
  // find out after an export has already failed. One indexed lookup, and only
  // for the handful of roles it can be true of.
  const booksInFortnox = canLogInToFortnox(currentUser.capabilities);
  const [holdsCard, fortnoxSession, cookieStore, counts, fiscalYears, fiscalYear] = await Promise.all([
    userHoldsCard(currentUser.id),
    booksInFortnox ? getFortnoxSession(currentUser.id) : null,
    cookies(),
    // The numbers beside the nav's links. Counts only, four of them, since
    // this runs for every page. They refresh with the layout, which every
    // write in the app does on its way out (see useMutation's refresh). In
    // the header's year, as the lists they lead to are.
    getFiscalYear().then((year) => getNavCounts(currentUser, year)),
    // The header's räkenskapsår: Fortnox's years and the one in force. The
    // pages ask getFiscalYear for themselves, and it is cached per request,
    // so they and this cannot disagree. See lib/server/fiscal-year.ts.
    getFiscalYears(),
    getFiscalYear(),
  ]);
  // Read here rather than in the client so the frame renders in its stored
  // shape on the first paint instead of settling into it after hydration, a
  // receipt flashing open at the wrong width.
  const receiptCollapsed = cookieStore.get(RECEIPT_COLLAPSED_COOKIE)?.value === "1";
  const storedWidth = Number(cookieStore.get(RECEIPT_WIDTH_COOKIE)?.value);
  const receiptWidth = Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : DEFAULT_WIDTH;

  return (
    <RoleProvider user={{ ...currentUser, holdsCard }}>
      <NotificationsProvider>
        <ConfirmProvider>
          <FortnoxAuthResult />
          {/* Outside AppShell for the same reason as the banners: it is fixed
              to the top of the viewport, not to the page column. It reads the
              query string to know when a navigation has landed, hence the
              boundary, nothing renders in the fallback, it is a 2px bar. */}
          <Suspense fallback={null}>
            <RouteProgressBar />
            {/* Beside the bar because it watches the same thing, the URL
                changing, and reads the query string to do it. See
                components/shell/route-history. */}
            <RouteHistoryRecorder />
            <SettingsReopener />
          </Suspense>
          {/* A fixed overlay, deliberately outside AppShell. Notifications
              float over the page rather than pushing the content down. */}
          <NotificationBanners />
          <ReceiptPanelProvider
            defaultCollapsed={receiptCollapsed}
            defaultWidth={receiptWidth}
          >
            {/* `fortnox` absent is "this reader has no Fortnox login of their
                own", which is most of them, and the nav shows nothing at all.
                Present with a null session is the treasury signed out. The
                one state the sidebar exists to catch. */}
            <AppShell
              fortnox={booksInFortnox ? { session: fortnoxSession } : undefined}
              fiscal={fiscalYear && { years: fiscalYears, selected: fiscalYear }}
              counts={{
                "/expenses": counts.expenses,
                "/bank": counts.bank,
                "/invoices/inbox": counts.invoiceInbox,
                "/invoices": counts.invoices,
              }}
            >
              {children}
            </AppShell>
            {/* Settings, floating over whichever of the above is underneath
                it. A sibling of AppShell rather than something rendered
                inside it: the app's own sidebar is exactly what this must
                not touch. */}
            {modal}
          </ReceiptPanelProvider>
        </ConfirmProvider>
      </NotificationsProvider>
    </RoleProvider>
  );
}
