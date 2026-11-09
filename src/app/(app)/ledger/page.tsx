import { requireUser } from "@/lib/server/current-user";
import { getCostCenters } from "@/lib/data/cost-centers";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import LedgerClient from "./ledger-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("ledger");

export default async function LedgerPage() {
  // Any signed-in member (the routes behind, /api/ledger/*, say the same).
  await requireUser();

  const [fortnox, costCenters, fiscal] = await Promise.all([
    getFortnoxStatus(),
    getCostCenters(),
    getFiscalYear(),
  ]);
  // Retired cost centres are offered too, so a closed year stays readable per cost centre.
  return (
    <LedgerClient
      key={fiscal?.id ?? "none"}
      fiscalYearId={fiscal?.id ?? null}
      fortnox={fortnox}
      costCenters={costCenters.map((c) => ({ code: c.code, name: c.name }))}
    />
  );
}
