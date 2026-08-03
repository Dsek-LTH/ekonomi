import { Suspense } from "react";
import { cookies } from "next/headers";
import { AppShell, SIDEBAR_COOKIE } from "@/components/shell/app-shell";
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
import { canLogInToFortnox } from "@/lib/domain/permissions";
import { getFortnoxSession } from "@/lib/data/fortnox";
import { userHoldsCard } from "@/lib/data/users";

// Always render against fresh DB data on a full load. Each page loads its own
// data (Server Components); the layout only resolves the session user + chrome.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentUser = await requireUser();

  // Only the treasury books in Fortnox, so only they get the status in their
  // profile menu — and only they cost a query for it.
  const showsFortnox = canLogInToFortnox(currentUser.roles);
  const [holdsCard, cookieStore, fortnoxSession] = await Promise.all([
    userHoldsCard(currentUser.id),
    cookies(),
    showsFortnox ? getFortnoxSession(currentUser.id) : null,
  ]);
  // Read here rather than in the client so the sidebar renders at its stored
  // width on the first paint instead of flashing open. The receipt panel is
  // remembered the same way, and for the same reason.
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";
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
              boundary — nothing renders in the fallback, it is a 2px bar. */}
          <Suspense fallback={null}>
            <RouteProgressBar />
          </Suspense>
          {/* A fixed overlay, deliberately outside AppShell — notifications
              float over the page rather than pushing the content down. */}
          <NotificationBanners />
          <ReceiptPanelProvider
            defaultCollapsed={receiptCollapsed}
            defaultWidth={receiptWidth}
          >
            <AppShell
              defaultCollapsed={sidebarCollapsed}
              fortnox={showsFortnox ? { session: fortnoxSession } : undefined}
            >
              {children}
            </AppShell>
          </ReceiptPanelProvider>
        </ConfirmProvider>
      </NotificationsProvider>
    </RoleProvider>
  );
}
