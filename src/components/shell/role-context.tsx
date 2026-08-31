"use client";

import { createContext, useContext } from "react";
import type { CurrentUser } from "@/lib/domain/types";

const Ctx = createContext<CurrentUser | null>(null);

// The current user comes from the Auth.js session (resolved in the app layout
// and passed in), enriched with the capabilities the session doesn't carry.
// Everything hangs off the one object, read `user.roles` / `user.holdsCard`.
export function RoleProvider({
  user,
  children,
}: {
  user: CurrentUser;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export function useRole(): { user: CurrentUser } {
  const user = useContext(Ctx);
  if (!user) throw new Error("useRole must be used within RoleProvider");
  return { user };
}
