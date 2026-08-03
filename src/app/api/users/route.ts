// Member search for the person pickers in Inställningar → Användare.
// Admin only: it exposes the section's member directory.
//
// There is deliberately no "list everyone" mode — the section has on the order
// of a thousand members, and every screen that needs a person needs one person.
import { NextResponse } from "next/server";
import { canAccessSettings } from "@/lib/domain/permissions";
import { searchUsers } from "@/lib/data/users";
import { gate } from "@/lib/api/guard";

export async function GET(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ users: await searchUsers(q) });
}
