import { Suspense } from "react";
import { cookies } from "next/headers";
import { AppShell, NAV_PINNED_COOKIE } from "@/components/shell/app-shell";
import { RouteHistoryRecorder } from "@/components/shell/route-history";
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
import { canLogInToFortnox } from "@/lib/domain/permissions";
import { THEME_COOKIE, parseTheme } from "@/lib/ui/theme";

// Always render against fresh DB data on a full load. Each page loads its own
// data (Server Components); the layout only resolves the session user + chrome.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentUser = await requireUser();

  // The treasury books under their own Fortnox login, and that login is
  // short-lived by design (see FortnoxStatus) — so whether it still holds is
  // something the frame carries for them, not something they go to /profile to
  // find out after an export has already failed. One indexed lookup, and only
  // for the handful of roles it can be true of.
  const booksInFortnox = canLogInToFortnox(currentUser.capabilities);
  const [holdsCard, fortnoxSession, cookieStore] = await Promise.all([
    userHoldsCard(currentUser.id),
    booksInFortnox ? getFortnoxSession(currentUser.id) : null,
    cookies(),
  ]);
  // Read here rather than in the client so the frame renders in its stored
  // shape on the first paint instead of settling into it after hydration — a
  // receipt flashing open at the wrong width, or a pinned sidebar snapping from
  // 64px to 256 and shoving the page sideways as it goes.
  const receiptCollapsed = cookieStore.get(RECEIPT_COLLAPSED_COOKIE)?.value === "1";
  const storedWidth = Number(cookieStore.get(RECEIPT_WIDTH_COOKIE)?.value);
  const receiptWidth = Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : DEFAULT_WIDTH;
  // Unset means the rail, which is the answer for the screens this was built
  // for; pinning is the wider screen opting out.
  const navPinned = cookieStore.get(NAV_PINNED_COOKIE)?.value === "1";
  // Read again here rather than handed down from the root layout: what that one
  // does with it is put a class on <html>, and a layout cannot pass values to
  // the layouts nested inside it. The cookie is the shared channel, and reading
  // it twice in one request costs nothing.
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <RoleProvider user={{ ...currentUser, holdsCard }}>
      <NotificationsProvider>
        <ConfirmProvider>
          <FortnoxAuthResult />
          {/* Outside AppShell for the same reason as the banners: it is fixed
              to the top of the viewport, not to the page column. It reads the
              query string to know when a navigation has landed, hence the
              boundary — nothing renders in the fallback, it is a 2px bar. */}
          <Suspense fallback={null}>
            <RouteProgressBar />
            {/* Beside the bar because it watches the same thing — the URL
                changing — and reads the query string to do it. What it
                remembers is what a back link returns you to. */}
            <RouteHistoryRecorder />
          </Suspense>
          {/* A fixed overlay, deliberately outside AppShell — notifications
              float over the page rather than pushing the content down. */}
          <NotificationBanners />
          <ReceiptPanelProvider
            defaultCollapsed={receiptCollapsed}
            defaultWidth={receiptWidth}
          >
            {/* `fortnox` absent is "this reader has no Fortnox login of their
                own", which is most of them, and the nav shows nothing at all.
                Present with a null session is the treasury signed out — the
                one state the sidebar exists to catch. */}
            <AppShell
              defaultPinned={navPinned}
              theme={theme}
              fortnox={booksInFortnox ? { session: fortnoxSession } : undefined}
            >
              {children}
            </AppShell>
          </ReceiptPanelProvider>
        </ConfirmProvider>
      </NotificationsProvider>
    </RoleProvider>
  );
}
