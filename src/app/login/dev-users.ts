import "server-only";

import { ROLES } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/types";
import { prisma } from "@/lib/server/db";

export interface DevUser {
  studentId: string;
  name: string;
  roles: Role[];
}

export async function getDevUsers(): Promise<DevUser[]> {
  if (process.env.NODE_ENV === "production") return [];

  const users = await prisma.user.findMany({
    select: { studentId: true, name: true, roles: true },
    orderBy: { name: "asc" },
  });
  const shown = (roles: Role[]) => {
    const real = roles.filter((r) => r !== "ORDINARIE");
    return real.length ? real : roles;
  };
  const rank = (roles: Role[]) => Math.min(...roles.map((r) => ROLES.indexOf(r)));

  return users
    .map((u) => ({ ...u, roles: shown(u.roles) }))
    .sort((a, b) => rank(a.roles) - rank(b.roles));
}
