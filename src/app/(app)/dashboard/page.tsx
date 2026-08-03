import { requireUser } from "@/lib/server/current-user";
import { getExpenseSummaries } from "@/lib/data/expenses";
import { buildQueue } from "@/lib/domain/queue";
import { DashboardClient } from "./dashboard-client";

// The dashboard answers one question — what needs you now — and it answers it
// the same way whatever roles you hold. It used to be three role-shaped blocks
// of counts, which meant a skattmästare who also owned a result unit rendered
// two of everything, and a first-time functionary was told "Allt är hanterat"
// over four zeroes.
//
// The queue is derived in `domain/queue.ts` so it stays testable without a
// database; this file's whole job is to fetch and hand over.
export default async function DashboardPage() {
  const user = await requireUser();
  const expenses = await getExpenseSummaries(user);

  const queue = buildQueue(expenses, user);
  const mine = expenses
    .filter((e) => e.submitterId === user.id)
    // Newest first: your own list answers "where did mine get to", which reads
    // backwards from the queue, where the oldest thing is the urgent one.
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));

  return (
    <DashboardClient
      firstName={user.name.split(" ")[0]}
      queue={queue}
      mine={mine}
    />
  );
}
