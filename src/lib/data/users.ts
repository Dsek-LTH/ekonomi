// Members: who they are, what they hold, and where their money goes.
import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/server/db";
import { initials } from "@/lib/ui/format";
import { ASSIGNABLE_ROLES } from "@/lib/domain/permissions";
import { roleCapabilities } from "@/lib/server/capabilities";
import type { Capability, Role, User } from "@/lib/domain/types";

// Rows as the UI shape. The initials are derived rather than stored, and the
// capabilities are resolved rather than either, so every query that returns
// people goes through here.
//
// The whole list at once rather than a mapper per row: the capability matrix is
// one query, request-cached, and resolving it here means a screen listing the
// section can say what each person may actually do, the question the roles
// beside their name are only half an answer to.
async function toUsers(
  rows: { id: string; name: string; email: string; roles: Role[] }[],
): Promise<User[]> {
  const matrix = await roleCapabilities();
  return rows.map((u) => {
    const caps = new Set<Capability>();
    for (const role of u.roles) for (const cap of matrix.get(role) ?? []) caps.add(cap);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      roles: u.roles,
      capabilities: [...caps],
      initials: initials(u.name),
    };
  });
}

// The four columns `toUsers` actually maps. Named once: a User row also carries
// the member's bank details, and a loader that selects the whole row hands them
// to every caller. Today they are dropped in the mapper, but the next field
// added to the shape would ship them without anyone deciding to.
const userSelect = { id: true, name: true, email: true, roles: true } as const;

export async function getUsers(): Promise<User[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: userSelect,
  });
  return toUsers(users);
}

// Only the members who hold something beyond the baseline ORDINARIE. With a
// whole section in the user table that is a couple of dozen rows rather than a
// thousand, which is what lets the settings view render eagerly.
export async function getRoleHolders(): Promise<User[]> {
  const users = await prisma.user.findMany({
    where: { roles: { hasSome: [...ASSIGNABLE_ROLES] } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: userSelect,
  });
  return toUsers(users);
}

// Name/email search for the person pickers. Capped, since the point is to find
// one member, not to page through the section.
export async function searchUsers(query: string, take = 20): Promise<User[]> {
  const q = query.trim();
  if (!q) return [];
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take,
    select: userSelect,
  });
  return toUsers(users);
}

// Does this user hold a section card? Drives one nav item; a count, not a list.
export const userHoldsCard = cache(async (userId: string): Promise<boolean> => {
  const n = await prisma.card.count({ where: { holderId: userId } });
  return n > 0;
});

// The member's payout details: for /profile, the reimbursement hint in the
// new/edit wizard, and the treasury's lookup in Inställningar → Användare
// (`/api/users/[id]/payout`). Deduped per request: the layout and the page
// underneath it both need them.
export const getPayoutAccount = cache(
  async (userId: string): Promise<{ clearing: string; account: string }> => {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { bankClearingNumber: true, bankAccountNumber: true },
    });
    return { clearing: u?.bankClearingNumber ?? "", account: u?.bankAccountNumber ?? "" };
  },
);
