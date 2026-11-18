// The counts beside the nav links, read again by the client after a change or a navigation
// (components/shell/nav-counts.tsx). The layout renders them once and is not rendered again on navigation.
import { NextResponse } from "next/server";
import { gate } from "@/lib/api/guard";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { getNavCounts, navCountsByHref } from "@/lib/data/nav-counts";

export async function GET() {
  const g = await gate();
  if (!g.ok) return g.res;
  const counts = await getNavCounts(g.actor, await getFiscalYear());
  return NextResponse.json(navCountsByHref(counts), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
