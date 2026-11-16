// The acting user is the signed-in Auth.js session user. Roles are read fresh from the database, not from
// the JWT (stamped at sign-in), the same way `gate()` does. Returns null when unauthenticated.
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/server/db";
import { capabilitiesOf } from "@/lib/server/capabilities";
import { initials } from "@/lib/ui/format";
import type { Capability, Role, SessionUser } from "@/lib/domain/types";
import { isStockSlug, type StockSlug } from "@/lib/stock/stocks";

/** Deduped per request: the shell and the page both call `requireUser()` concurrently, and two decodes race for one refresh token. */
export const resolveUserId = cache(async (): Promise<string | null> => {
  const session = await auth();
  return session?.user?.id ?? null;
});

/**
 * The user row behind a session, plus what its roles currently allow. Deduped per request. Shared with
 * `gate()` in lib/api/guard.ts. Capabilities are resolved from the matrix here, not stored on the row.
 */
export const loadUser = cache(
  async (
    id: string,
  ): Promise<{
    name: string;
    email: string;
    studentId: string;
    roles: Role[];
    capabilities: Capability[];
    stockPlaceIds: string[];
    placeStocks: StockSlug[];
  } | null> => {
    const row = await prisma.user.findUnique({
      where: { id },
      // studentId is the STIL-ID printed on an intäktsräkning (lib/income/config.ts).
      select: { name: true, email: true, studentId: true, roles: true, stockPlaceIds: true },
    });
    if (!row) return null;
    const [capabilities, placeStocks] = await Promise.all([
      capabilitiesOf(row.roles),
      stocksOfPlaces(row.stockPlaceIds),
    ]);
    return { ...row, capabilities, placeStocks };
  },
);

/** The stocks a person holds a place in, so the gates need not load the places themselves. Archived places count for nothing. */
async function stocksOfPlaces(ids: readonly string[]): Promise<StockSlug[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.stockPlace.findMany({
    where: { id: { in: [...ids] }, archived: false },
    select: { stockId: true },
    distinct: ["stockId"],
  });
  return rows.map((r) => r.stockId).filter(isStockSlug);
}

// The full acting user mapped to the UI `SessionUser` shape. Null when unauthenticated or the account is gone.
async function resolveSessionUser(): Promise<SessionUser | null> {
  const id = await resolveUserId();
  if (!id) return null;

  const row = await loadUser(id);
  if (!row) return null;

  const name = row.name || row.email || "Användare";
  return {
    id,
    name,
    email: row.email,
    roles: row.roles,
    capabilities: row.capabilities,
    stockPlaceIds: row.stockPlaceIds,
    placeStocks: row.placeStocks,
    initials: initials(name),
  };
}

/** The acting user, or a redirect to sign-in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await resolveSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The acting user, provided they may reach this page. Otherwise the dashboard. Takes a capability
 * predicate from lib/domain/permissions.ts, e.g. `requirePage(canAccessSettings)`.
 */
export async function requirePage(
  can: (caps: readonly Capability[]) => boolean,
): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.capabilities)) redirect("/dashboard");
  return user;
}
