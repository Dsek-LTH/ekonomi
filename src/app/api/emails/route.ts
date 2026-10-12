// GET /api/emails: the outbox as a log, newest first, a page at a time.
//
//   ?recipient=<userId>   one member's mail (the person dialog under Användare)
//   ?filter=sent|unsent|failed
//   ?q=<text>             subject, or the recipient's name or address
//   ?take=<n>             how many rows, newest first (a page at the least)
//
// Settings only. A mail says what happened to somebody's utlägg, with the
// comment left on it, so the log is as private as the utlägg are.
import { NextResponse } from "next/server";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getEmailLog, type EmailFilter } from "@/lib/data/emails";
import { gate } from "@/lib/api/guard";

const FILTERS: readonly EmailFilter[] = ["sent", "unsent", "failed"];

export async function GET(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const params = new URL(req.url).searchParams;
  const filter = params.get("filter") as EmailFilter | null;
  return NextResponse.json(
    await getEmailLog({
      recipientId: params.get("recipient") || undefined,
      filter: filter && FILTERS.includes(filter) ? filter : "",
      q: params.get("q")?.trim() || undefined,
      take: Number(params.get("take")) || undefined,
    }),
  );
}
