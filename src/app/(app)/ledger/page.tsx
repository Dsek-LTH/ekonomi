import { requireUser } from "@/lib/server/current-user";
import { getCostCenters } from "@/lib/data/cost-centers";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import LedgerClient from "./ledger-client";

export default async function LedgerPage() {
  // Any signed-in member: the utfall is the section's own accounting and the
  // budget beside it is open to everyone, so this matches. Stated rather than
  // inherited from the layout: "any member" is a policy, and the routes behind
  // this page (/api/ledger/*) say the same thing on their first line.
  await requireUser();

  const [fortnox, costCenters] = await Promise.all([
    getFortnoxStatus(),
    getCostCenters(),
  ]);
  // Retired cost centres are offered too: a closed year's report still has to
  // be readable per cost centre after one has been retired.
  return (
    <LedgerClient
      fortnox={fortnox}
      costCenters={costCenters.map((c) => ({ code: c.code, name: c.name }))}
    />
  );
}
