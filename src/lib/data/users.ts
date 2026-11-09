import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/server/db";
import { initials } from "@/lib/ui/format";
import { ASSIGNABLE_ROLES } from "@/lib/domain/permissions";
import { roleCapabilities } from "@/lib/server/capabilities";
import type { Capability, Role, User } from "@/lib/domain/types";

// Initials and capabilities are derived, not stored. Capabilities come from one request-cached matrix query.
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

// Only the columns `toUsers` maps, so bank details never leave with the row.
const userSelect = { id: true, name: true, email: true, roles: true } as const;

export async function getUsers(): Promise<User[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: userSelect,
  });
  return toUsers(users);
}

// Only members holding something beyond the baseline ORDINARIE.
export async function getRoleHolders(): Promise<User[]> {
  const users = await prisma.user.findMany({
    where: { roles: { hasSome: [...ASSIGNABLE_ROLES] } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: userSelect,
  });
  return toUsers(users);
}

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

export const userHoldsCard = cache(async (userId: string): Promise<boolean> => {
  const n = await prisma.card.count({ where: { holderId: userId } });
  return n > 0;
});

// Deduped per request: the layout and the page both need them.
export const getPayoutAccount = cache(
  async (userId: string): Promise<{ clearing: string; account: string }> => {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { bankClearingNumber: true, bankAccountNumber: true },
    });
    return { clearing: u?.bankClearingNumber ?? "", account: u?.bankAccountNumber ?? "" };
  },
);

/** Members with a profile picture and its version (set-at in ms), for AvatarProvider. */
export const getAvatarVersions = cache(async (): Promise<Record<string, number>> => {
  const rows = await prisma.user.findMany({
    where: { avatarUpdatedAt: { not: null } },
    select: { id: true, avatarUpdatedAt: true },
  });
  return Object.fromEntries(rows.map((r) => [r.id, r.avatarUpdatedAt!.getTime()]));
});

export const getSeenGuideSteps = cache(async (userId: string): Promise<string[]> => {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { seenGuideSteps: true },
  });
  return u?.seenGuideSteps ?? [];
});
