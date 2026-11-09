"use client";

import { createContext, useContext } from "react";
import type { CurrentUser } from "@/lib/domain/types";

const Ctx = createContext<CurrentUser | null>(null);

export function RoleProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export function useRole(): { user: CurrentUser } {
  const user = useContext(Ctx);
  if (!user) throw new Error("useRole must be used within RoleProvider");
  return { user };
}
