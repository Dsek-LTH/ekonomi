// Imports intakt's routing table — which product prefix belongs to which
// committee and books to which account — out of its config.yaml and into the
// database.
//
// This is a migration, not a sync. Until now the table lived in a YAML file on
// the treasurer's laptop, which meant it could only be changed by whoever had
// the file, and intakt and the app could disagree about it. Afterwards the
// database is the only copy: the app edits it, and serialises it into every
// request it sends the service. Run once, keep the YAML as a record, and edit
// in the app from then on.
//
//   tsx prisma/import/import-income-config.ts [path/to/config.yaml]
//
// Re-runnable: committees and prefixes are upserted by their natural keys, so
// running it twice changes nothing and running it after editing the YAML brings
// the changes across. It does not delete — a committee removed from the file is
// left alone rather than taking its reports with it.
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

import { PrismaClient } from "../../src/lib/generated/prisma/client";
import { loadEnvFile } from "../load-env";

loadEnvFile();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// The shape intakt's config.Config serialises to. Only the parts that move into
// the database are described — out_path, attestation and the fortnox block stay
// behind with the CLI, since the app has its own answers for all three.
interface YamlPrefix {
  name: string; // committee key
  account: number;
}
interface YamlCommittee {
  proper_name?: string;
  description?: string;
  default_cost_center?: string;
}
interface IntaktConfig {
  prefix_mappings?: Record<string, YamlPrefix>;
  committees?: Record<string, YamlCommittee>;
  swish_amount_fallbacks?: Record<string, string>;
}

// Which prefix catches products matching nothing. intakt hard-coded this to
// "sk" — see the `fallback` in report/purchases.go — so that is what the import
// carries across, and it becomes an editable flag rather than a constant.
const FALLBACK_PREFIX = "sk";

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const path = process.argv[2] ?? "intakt/config.yaml";

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    fail(`Could not read ${path}. Pass the path to intakt's config.yaml as an argument.`);
  }

  const cfg = parse(raw) as IntaktConfig;
  const committees = cfg.committees ?? {};
  const prefixes = cfg.prefix_mappings ?? {};

  if (Object.keys(committees).length === 0) fail(`${path} defines no committees.`);
  if (Object.keys(prefixes).length === 0) fail(`${path} defines no prefix_mappings.`);

  // Every prefix has to name a committee that exists, which is the one rule
  // intakt's own validation enforces. Checked before anything is written, so a
  // typo does not leave the table half-imported.
  for (const [code, prefix] of Object.entries(prefixes)) {
    if (!committees[prefix.name]) {
      fail(`prefix_mappings["${code}"] routes to committee "${prefix.name}", which is not defined.`);
    }
  }

  // Cost centres are matched by code against what the app already has, which is
  // mirrored from Fortnox. A committee naming one that does not exist is not
  // fatal — it imports without a default, and the treasurer picks one per
  // report — but it is worth saying, since silently dropping it would look like
  // the setting had been imported.
  const codes = [...new Set(Object.values(committees).map((c) => c.default_cost_center).filter((c) => typeof c === "string"))];
  const found = await prisma.costCenter.findMany({
    where: { code: { in: codes as string[] } },
    select: { id: true, code: true },
  });
  const costCentreIdByCode = new Map(found.map((c) => [c.code, c.id]));
  const unresolved = (codes as string[]).filter((code) => !costCentreIdByCode.has(code));

  console.log(`Importing from ${path}`);
  console.log(`  ${Object.keys(committees).length} committees, ${Object.keys(prefixes).length} prefixes`);

  for (const [key, committee] of Object.entries(committees)) {
    const costCenterId = committee.default_cost_center
      ? (costCentreIdByCode.get(committee.default_cost_center) ?? null)
      : null;

    // The verksamhet is a resultatenhet: one register, so the YAML's name is
    // matched against the units that exist and only creates one when it names
    // something the section does not have yet.
    const name = committee.proper_name?.trim() || key;
    const unit =
      (await prisma.resultUnit.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      })) ?? (await prisma.resultUnit.create({ data: { name }, select: { id: true } }));

    await prisma.resultUnitIncome.upsert({
      where: { key },
      create: {
        key,
        resultUnitId: unit.id,
        description: committee.description?.trim() ?? "",
        defaultCostCenterId: costCenterId,
      },
      // The cost centre is deliberately updated too: this script is how the
      // YAML is brought across, and a stale link would be the thing it was
      // supposed to fix.
      update: {
        resultUnitId: unit.id,
        description: committee.description?.trim() ?? "",
        defaultCostCenterId: costCenterId,
      },
    });
  }

  const incomeIdByKey = new Map(
    (await prisma.resultUnitIncome.findMany({ select: { id: true, key: true } })).map((i) => [i.key, i.id]),
  );

  // The fallback flag is guarded by a partial unique index, so two rows can
  // never claim it. Clearing it first keeps a re-run from colliding with the
  // row that already holds it.
  await prisma.incomeProductPrefix.updateMany({ where: { isFallback: true }, data: { isFallback: false } });

  for (const [code, prefix] of Object.entries(prefixes)) {
    const incomeId = incomeIdByKey.get(prefix.name);
    if (!incomeId) fail(`Verksamhet "${prefix.name}" was not imported — this should not happen.`);

    const normalised = code.trim().toLowerCase();
    await prisma.incomeProductPrefix.upsert({
      where: { code: normalised },
      create: {
        code: normalised,
        incomeId,
        account: String(prefix.account),
        isFallback: normalised === FALLBACK_PREFIX,
      },
      update: {
        incomeId,
        account: String(prefix.account),
        isFallback: normalised === FALLBACK_PREFIX,
      },
    });
  }

  const fallbacks = cfg.swish_amount_fallbacks ?? {};
  for (const [amount, message] of Object.entries(fallbacks)) {
    const ore = Number(amount);
    if (!Number.isInteger(ore) || ore <= 0) {
      console.warn(`  ! skipping swish_amount_fallbacks["${amount}"]: not a positive whole number of öre`);
      continue;
    }
    await prisma.swishAmountFallback.upsert({
      where: { amount: ore },
      create: { amount: ore, message },
      update: { message },
    });
  }

  // ── What the treasurer needs to know before trusting this ──

  const accounts = [...new Set(Object.values(prefixes).map((p) => String(p.account)))];
  const knownAccounts = new Set(
    (await prisma.account.findMany({ where: { number: { in: accounts } }, select: { number: true } })).map(
      (a) => a.number,
    ),
  );
  const unknownAccounts = accounts.filter((a) => !knownAccounts.has(a));

  console.log(`\nImported.`);
  console.log(`  verksamheter          ${await prisma.resultUnitIncome.count()}`);
  console.log(`  prefixes              ${await prisma.incomeProductPrefix.count()}`);
  console.log(`  swish fallbacks       ${await prisma.swishAmountFallback.count()}`);

  const withoutCostCentre = await prisma.resultUnitIncome.count({ where: { defaultCostCenterId: null } });
  if (withoutCostCentre > 0) {
    console.log(
      `\n  ${withoutCostCentre} verksamhet(er) have no default cost centre. Reports from them start blank,` +
        `\n  and one has to be chosen before they can be booked.`,
    );
  }
  if (unresolved.length > 0) {
    console.log(
      `\n  ! These cost centres are named in the YAML but do not exist here: ${unresolved.join(", ")}` +
        `\n    Sync cost centres from Fortnox, then re-run this, or set them in the app.`,
    );
  }
  if (unknownAccounts.length > 0) {
    console.log(
      `\n  ! These accounts are not in the chart of accounts: ${unknownAccounts.join(", ")}` +
        `\n    Vouchers booking to them will be rejected by Fortnox. Sync accounts, or fix the prefix.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
