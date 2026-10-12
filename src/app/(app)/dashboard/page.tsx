import { requireUser } from "@/lib/server/current-user";
import { getDashboardExpenses } from "@/lib/data/expenses";
import { buildQueue } from "@/lib/domain/queue";
import { DashboardClient } from "./dashboard-client";

// How many of your own utlägg the dashboard previews before handing you off to
// the list built for browsing. The old page said "senaste" and then rendered
// every one of them, which made it an unbounded copy of /expenses.
//
// It lives here, on the server, because this is what decides how many rows are
// *fetched*. It cannot live in dashboard-client: that module is "use client",
// and a Server Component importing a value from one gets a client reference
// rather than the value: `take: [object Function]`, which is exactly what
// Prisma reported when it did.
const MINE_PREVIEW = 5;

// The dashboard answers one question (what needs you now) and it answers it
// the same way whatever roles you hold. It used to be three role-shaped blocks
// of counts, which meant a skattmästare who also owned a result unit rendered
// two of everything, and a first-time functionary was told "Allt är hanterat"
// over four zeroes.
//
// The queue is derived in `domain/queue.ts` so it stays testable without a
// database; this file's whole job is to fetch and hand over. What it fetches is
// no longer "every utlägg in the section", see getDashboardExpenses.
export default async function DashboardPage() {
  const user = await requireUser();
  const { queueCandidates, mine } = await getDashboardExpenses(user, MINE_PREVIEW);

  return (
    <DashboardClient
      firstName={user.name.split(" ")[0]}
      queue={buildQueue(queueCandidates, user)}
      // Already newest first out of the query: your own list answers "where did
      // mine get to", which reads backwards from the queue, where the oldest
      // thing is the urgent one.
      mine={mine}
    />
  );
}
