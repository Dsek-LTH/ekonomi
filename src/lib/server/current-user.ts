// The acting user is the signed-in Auth.js session user (mapped to our DB User
// id during sign-in). Returns null when unauthenticated.
//
// The session says *who* is acting; the database says what they may do. Those
// are two different questions and only the first one a JWT can answer: the
// token is stamped at sign-in and never written again (see `session` in
// auth.ts), so a role granted this morning would not reach the nav until the
// holder next signed in, and one taken away would keep opening doors just as
// long — which is also why a session lasts a day and not a month. So the roles
// here are read fresh, the same way `gate()` reads them for an API route — one
// indexed lookup, deduped per request, and the two halves of the app agree
// about who you are.
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/server/db";
import { capabilitiesOf } from "@/lib/server/capabilities";
import { initials } from "@/lib/ui/format";
import type { Capability, Role, User } from "@/lib/domain/types";

/**
 * Deduped per request, like `loadUser` below and for a sharper reason: a
 * navigation renders the shell and the page inside it concurrently, and both
 * begin with `requireUser()` (app/(app)/layout.tsx and every page under it). Two
 * calls is two decodes of the same cookie for the same answer — and while the
 * jwt callback still refreshed an OAuth token, it was two of those in flight at
 * once, racing for a refresh token that only one of them could spend.
 */
export const resolveUserId = cache(async (): Promise<string | null> => {
  const session = await auth();
  return session?.user?.id ?? null;
});

/**
 * The user row behind a session, plus what those roles currently allow. Deduped
 * per request: a page that resolves the user and then gates on it — or a layout
 * that does it once for the chrome and again for the page inside it — should not
 * pay twice.
 *
 * Shared with `gate()` in lib/api/guard.ts so there is exactly one answer to
 * "who is this and what may they do", whichever half of the app is asking.
 *
 * The capabilities are resolved here rather than stored on the row, because
 * they are a property of the *matrix* and not of the person: retick a box in
 * Inställningar → Roller and every request after it is decided by the new grid,
 * with nothing to migrate onto a thousand rows. The matrix is one small query,
 * itself deduped per request (lib/server/capabilities.ts).
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
  } | null> => {
    const row = await prisma.user.findUnique({
      where: { id },
      // studentId rides along because it is on the same row and it is what the
      // section knows a person by: it is the STIL-ID printed on an
      // intäktsräkning beside their name (lib/income/config.ts). Fetching it
      // separately would be a second lookup for a column already in hand.
      select: { name: true, email: true, studentId: true, roles: true },
    });
    if (!row) return null;
    return { ...row, capabilities: await capabilitiesOf(row.roles) };
  },
);

// The full acting user mapped to the UI `User` shape, for Server Component
// pages that render the current user. Null when unauthenticated — or when the
// session outlived the account it names, which is not a permission problem and
// is answered the same way.
async function resolveSessionUser(): Promise<User | null> {
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
    initials: initials(name),
  };
}

// ── What a page starts with ────────────────────────────────────────
// The counterparts of `gate()` in lib/api/guard.ts: a page says what it
// requires on its first line, and everything after it can assume that held.
// An API route answers 401/403; a page redirects, which is the same policy
// expressed in the only way a browser navigation can express it.

/** The acting user, or a redirect to sign-in. */
export async function requireUser(): Promise<User> {
  const user = await resolveSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The acting user, provided they may reach this page — otherwise the dashboard,
 * which every signed-in member can see.
 *
 * Takes a capability predicate from lib/domain/permissions.ts, so the call site
 * reads `requirePage(canAccessSettings)` and does not have to know that the
 * answer now comes from a table. The capabilities are the live ones (see
 * `loadUser`), so this and the `gate()` behind the page's writes are deciding on
 * the same facts.
 */
export async function requirePage(
  can: (caps: readonly Capability[]) => boolean,
): Promise<User> {
  const user = await requireUser();
  if (!can(user.capabilities)) redirect("/dashboard");
  return user;
}
