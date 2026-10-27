// Who the dev sign-in offers: whoever is in the database.
//
// Read from the table rather than written out, because the dev provider (see
// auth.ts) only signs in a user who already exists. A list kept in the client
// offered people a reseed had not created yet, and clicking one of them was a
// refusal.
import "server-only";

import { ROLES } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/types";
import { prisma } from "@/lib/server/db";

export interface DevUser {
  studentId: string;
  name: string;
  roles: Role[];
}

/** Everyone, the most senior role first, then by name. Nobody in production. */
export async function getDevUsers(): Promise<DevUser[]> {
  if (process.env.NODE_ENV === "production") return [];

  const users = await prisma.user.findMany({
    select: { studentId: true, name: true, roles: true },
    orderBy: { name: "asc" },
  });
  // ORDINARIE is the baseline everyone holds, so it says something only about
  // a member who holds nothing else.
  const shown = (roles: Role[]) => {
    const real = roles.filter((r) => r !== "ORDINARIE");
    return real.length ? real : roles;
  };
  const rank = (roles: Role[]) => Math.min(...roles.map((r) => ROLES.indexOf(r)));

  return users
    .map((u) => ({ ...u, roles: shown(u.roles) }))
    .sort((a, b) => rank(a.roles) - rank(b.roles));
}
