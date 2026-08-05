// The acting user is the signed-in Auth.js session user (mapped to our DB User
// id during sign-in). Returns null when unauthenticated.
//
// The session says *who* is acting; the database says what they may do. Those
// are two different questions and only the first one a JWT can answer: the
// token is stamped at sign-in and never refreshed, so a role granted this
// morning would not reach the nav until the holder next signed out, and one
// taken away would keep opening doors just as long. So the roles here are read
// fresh, the same way `gate()` reads them for an API route — one indexed lookup,
// deduped per request, and the two halves of the app agree about who you are.
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/server/db";
import { initials } from "@/lib/ui/format";
import type { Role, User } from "@/lib/domain/types";

export async function resolveUserId(): Promise<string | null> {
  const session = await auth();
  // An errored session is one Authentik would not renew — usually because it
  // was revoked at that end. Honouring it here would be this app insisting
  // somebody is signed in after the place that decides has said otherwise, so
  // it counts as signed out and the caller sends them back to /login.
  if (session?.error) return null;
  return session?.user?.id ?? null;
}

/**
 * The user row behind a session, as it stands right now. Deduped per request:
 * a page that resolves the user and then gates on it — or a layout that does it
 * once for the chrome and again for the page inside it — should not pay twice.
 *
 * Shared with `gate()` in lib/api/guard.ts so there is exactly one answer to
 * "what roles does this person hold", whichever half of the app is asking.
 */
export const loadUser = cache(
  async (id: string): Promise<{ name: string; email: string; roles: Role[] } | null> =>
    prisma.user.findUnique({
      where: { id },
      select: { name: true, email: true, roles: true },
    }),
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
 * which every signed-in member can see. The roles are the live ones (see
 * `loadUser`), so this and the `gate()` behind the page's writes are deciding
 * on the same facts.
 */
export async function requirePage(
  can: (roles: readonly Role[]) => boolean,
): Promise<User> {
  const user = await requireUser();
  if (!can(user.roles)) redirect("/dashboard");
  return user;
}
