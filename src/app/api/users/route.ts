// Member search for the person pickers in Inställningar -> Användare. Settings or GRANT_ACCESS. No "list everyone"
// mode: the section has about a thousand members.
import { NextResponse } from "next/server";
import { canSeeUsers } from "@/lib/domain/permissions";
import { searchUsers } from "@/lib/data/users";
import { gate } from "@/lib/api/guard";

export async function GET(req: Request) {
  const g = await gate(canSeeUsers, "auth.adminOnly");
  if (!g.ok) return g.res;

  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ users: await searchUsers(q) });
}
