// CLI ledger sync — for the initial full backfill and for scheduled (cron) runs.
//   pnpm fortnox:sync          → sync the current financial year
//   pnpm fortnox:sync --all    → sync every financial year (full backfill)
//   pnpm fortnox:sync --year 9 → sync one Fortnox financial-year id
//
// Env (.env) is loaded before importing anything that reads DATABASE_URL.
import { loadEnvFile } from "./load-env";

loadEnvFile();

async function main() {
  const { syncLedger } = await import("../src/lib/fortnox/sync");

  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const yearArg = args.indexOf("--year");
  const year = yearArg >= 0 ? Number(args[yearArg + 1]) : undefined;

  console.log(
    `Syncing Fortnox ledger (${year != null ? `year ${year}` : all ? "all years" : "current year"})…`,
  );
  const t0 = Date.now();
  const result = await syncLedger({ scope: all ? "all" : "current", year });
  for (const y of result.years) {
    console.log(`  FY ${y.financialYear}: ${y.vouchers} vouchers, ${y.rows} rows`);
  }
  const total = result.years.reduce((s, y) => s + y.vouchers, 0);
  console.log(`Done: ${total} vouchers in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .then(async () => {
    const { prisma } = await import("../src/lib/server/db");
    await prisma.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
