// Seeds the database from the static fixtures in prisma/seed-data.ts, once
// the frontend mock dataset, so the real app starts with the same scenarios
// the design was validated against.
// Idempotent: wipes the domain tables and re-inserts on every run.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Role } from "../src/lib/generated/prisma/client";

// Standalone run (pnpm db:seed). Load .env ourselves.
import { loadEnvFile } from "../scripts/load-env";
import {
  DEFAULT_GROUP_RESULT_UNITS,
  DEFAULT_GROUP_ROLES,
  DEFAULT_ROLE_CAPABILITIES,
} from "../src/lib/server/authority-defaults";

loadEnvFile();
import { bucket, deleteKeys, ensureBucket, listObjects } from "../scripts/storage-admin";
import {
  CARDS,
  CURRENT_USERS,
  EXPENSES,
  EXTRA_ACCOUNTS,
  PROJECTS,
  RENTAL_ITEMS,
  STOCK_EVENTS,
  STOCK_PRODUCTS,
  UNIT_OWNERS,
} from "./seed-data";
import { seedExpenses, dayBefore } from "./seed-expenses";
import { DEFAULT_ROLE_CAPABILITIES as ROLE_CAPS } from "../src/lib/server/authority-defaults";
import { rateOn } from "../src/lib/mileage/rate";
import { today as stockholmToday } from "../src/lib/domain/date";
import type { Capability } from "../src/lib/domain/types";
import { replay, type ReplayRow } from "../src/lib/stock/replay";
import { buildBudget, loadBudgetJson, type BudgetJson } from "../scripts/import/budget-json";
import { evaluatorInputs } from "../src/lib/budget/inputs";
import { evaluate } from "../src/lib/budget/eval";
import { effectiveKind } from "../src/lib/budget";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ascii = (name: string) =>
  name.toLowerCase().replace(/å|ä/g, "a").replace(/ö/g, "o");

// "Elsa Lindqvist" → "elsa.lindqvist@user.dsek.se"
const emailFor = (name: string) => ascii(name).replace(/\s+/g, ".") + "@user.dsek.se";

// "Elsa Lindqvist" → "el1234li-s". The app keys users on the student id that
// Authentik sends as `preferred_username`, so the fixtures need ones shaped
// like LTH's: two letters of the given name, four digits, two of the family
// name. The digits are derived from the name rather than random, so a reseed
// gives the same person the same id and the ones hard-coded in the dev
// sign-in (app/login/page.tsx) keep working.
const studentIdFor = (name: string) => {
  const [first = "", last = ""] = ascii(name).split(/\s+/);
  const digits = String(
    [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 10000, 7),
  ).padStart(4, "0");
  return `${first.slice(0, 2)}${digits}${last.slice(0, 2)}-s`;
};

// A Swedish bank account for a member's payouts, derived from the name so a
// reseed gives the same person the same one. Everyone seeded has filled in
// their profile: an eget utlägg cannot be submitted without it.
const payoutFor = (name: string) => {
  const h = [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 1_000_000_007, 11);
  return {
    bankClearingNumber: String(8000 + (h % 1000)).padStart(4, "0") + "-" + (h % 10),
    bankAccountNumber: String(h).padStart(10, "0").slice(0, 10),
  };
};

// The workbook names some result units differently from the app, and the app's
// names are the ones that matter: they are what Authentik's groups are mapped
// to (lib/server/authority-defaults.ts), so a unit seeded under the workbook's
// name would be one nobody's group answers for.
const APP_UNIT_NAMES: Record<string, string> = {
  "Cafémästeriet": "Caféutskottet",
  "Centralprocessutskottet": "CPU",
  "Informationsutskottet": "Infoutskottet",
  "Medaljelelekommitén": "Medaljkommittén",
  "Trivselrådet": "Trivselutskottet",
};
const appUnitName = (sheet: string) => APP_UNIT_NAMES[sheet] ?? sheet;

// A stable number in [0, 1) from a string, so a reseed books the same utfall.
const hash01 = (s: string) =>
  ([...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261) % 1000) / 1000;

/**
 * A year of bookkeeping against the adopted budget, as if it had come from
 * Fortnox: one financial year, and a voucher per cost centre per month up to
 * this one, each account's month booked against the bank account the
 * settings name, so every voucher balances.
 *
 * Each cost centre spends at its own pace, from about half of what the year so
 * far would allow to about half again as much, so the dashboard's budget card
 * and the ledger reports have some units on track, some ahead and some over
 * to show. Income follows the same pace. Returns how many rows it wrote.
 */
async function seedLedger(
  data: BudgetJson,
  budgetId: string,
  bank: { number: string; name: string },
): Promise<{ rows: number; lastNumber: number }> {
  const year = data.year;
  const today = new Date();
  // A past year is a whole year; this year is up to this month.
  const months = today.getFullYear() > year ? 12 : Math.max(1, today.getMonth() + 1);
  const elapsed = months / 12;

  const budget = await prisma.budget.findUniqueOrThrow({
    where: { id: budgetId },
    include: {
      variables: true,
      changes: { include: { entries: true } },
      costCenters: { include: { costCenter: true, accounts: { include: { lineItems: true } } } },
    },
  });
  const inputs = evaluatorInputs(budget);
  const { accounts } = evaluate(inputs.variables, inputs.lineItems, [], inputs.adjustments, inputs.knownAccounts);

  await prisma.fortnoxFinancialYear.create({
    data: {
      id: 1,
      fromDate: new Date(Date.UTC(year, 0, 1)),
      toDate: new Date(Date.UTC(year, 11, 31)),
      lastSyncAt: today,
    },
  });

  let number = 0;
  let written = 0;
  for (const cc of budget.costCenters) {
    if (!cc.costCenter) continue;
    const code = cc.costCenter.code;
    const pace = 0.55 + hash01(code) * 0.95;
    // Each account's whole-year figure in öre, signed as the ledger signs it.
    const lines = cc.accounts.flatMap((a) => {
      const ore = accounts.get(`${code}:${a.accountCode}`) ?? 0;
      if (!ore) return [];
      const income = effectiveKind(a.accountCode) === "INCOME";
      return [{ account: a.accountCode, name: a.accountName, ore: Math.abs(ore), income }];
    });
    if (lines.length === 0) continue;

    for (let m = 0; m < months; m++) {
      const date = new Date(Date.UTC(year, m, 15));
      const rows = lines
        .map((l) => {
          // The year so far at this unit's pace, spread over the months, a
          // little uneven so the months are not twelve identical vouchers.
          const wobble = 0.7 + hash01(`${code}${l.account}${m}`) * 0.6;
          const amount = Math.round(((l.ore * pace * elapsed) / months) * wobble);
          return { ...l, amount };
        })
        .filter((r) => r.amount > 0);
      if (rows.length === 0) continue;
      const net = rows.reduce((n, r) => n + (r.income ? -r.amount : r.amount), 0);
      number += 1;
      await prisma.ledgerVoucher.create({
        data: {
          financialYear: 1,
          series: "A",
          number,
          date,
          description: `${cc.costCenter.name} ${date.toLocaleString("sv-SE", { month: "long" })}`,
          rows: {
            create: [
              ...rows.map((r) => ({
                financialYear: 1,
                date,
                account: r.account,
                accountName: r.name,
                costCenterCode: code,
                costCenterName: cc.costCenter!.name,
                debit: r.income ? 0 : r.amount,
                credit: r.income ? r.amount : 0,
              })),
              {
                financialYear: 1,
                date,
                account: bank.number,
                accountName: bank.name,
                debit: net < 0 ? -net : 0,
                credit: net > 0 ? net : 0,
              },
            ],
          },
        },
      });
      written += rows.length + 1;
    }
  }
  return { rows: written, lastNumber: number };
}

/**
 * The bar's stock: the products, a delivery, and two nights drawing on it.
 *
 * Written straight to the table rather than through the route, so what the
 * route works out per movement is worked out here afterwards, the same way
 * `pnpm stock:revalue` does: the product's whole log replayed in order
 * (lib/stock/replay.ts), and each row given the value it settles at.
 */
async function seedStock(actorId: string) {
  const productId = new Map<string, string>();
  for (const p of STOCK_PRODUCTS) {
    const row = await prisma.stockProduct.create({
      data: {
        name: p.name,
        kind: p.kind,
        category: p.category,
        abv: p.abv,
        unitMl: p.kind === "UNIT" ? p.ml : null,
        nominalMl: p.kind === "VOLUME" ? p.ml : null,
        costPriceOre: p.costPriceOre,
        shelfLifeMonths: p.kind === "UNIT" ? 9 : null,
        tags: p.tags ?? [],
      },
    });
    productId.set(p.name, row.id);
    await prisma.stockEntry.create({
      data: {
        productId: row.id,
        kind: "PURCHASE",
        units: p.delivered,
        unitCostOre: p.costPriceOre,
        occurredAt: new Date("2026-09-01"),
        actorId,
        note: "Leverans till terminsstarten",
      },
    });
  }

  for (const e of STOCK_EVENTS) {
    const event = await prisma.stockEvent.create({
      data: { name: e.name, date: new Date(e.date), actorId },
    });
    for (const m of e.moves) {
      const id = productId.get(m.product);
      if (!id) throw new Error(`STOCK_EVENTS names "${m.product}", which is not a product`);
      const at = { productId: id, eventId: event.id, occurredAt: new Date(e.date), actorId };
      await prisma.stockEntry.create({ data: { ...at, kind: "CHECKOUT", units: -m.out } });
      if (m.back || m.backOpen) {
        await prisma.stockEntry.create({
          data: {
            ...at,
            kind: "RETURN",
            units: m.back ?? 0,
            open80: m.backOpen?.[80] ?? 0,
            open60: m.backOpen?.[60] ?? 0,
            open40: m.backOpen?.[40] ?? 0,
            open20: m.backOpen?.[20] ?? 0,
          },
        });
      }
    }
  }

  // Each product's log, settled.
  for (const id of productId.values()) {
    const rows = await prisma.stockEntry.findMany({
      where: { productId: id },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    });
    const settled = replay(
      rows.map(
        (r): ReplayRow => ({
          id: r.id,
          kind: r.kind,
          level: r.level,
          units: r.units,
          open: { 80: r.open80, 60: r.open60, 40: r.open40, 20: r.open20 },
          countedQty: r.countedQty,
          valueDeltaOre: r.valueDeltaOre,
          unitCostOre: r.unitCostOre,
        }),
      ),
    );
    for (const r of rows) {
      const want = settled.get(r.id);
      if (!want) continue;
      await prisma.stockEntry.update({
        where: { id: r.id },
        data: {
          units: want.units,
          open80: want.open[80] ?? 0,
          open60: want.open[60] ?? 0,
          open40: want.open[40] ?? 0,
          open20: want.open[20] ?? 0,
          valueDeltaOre: want.valueDeltaOre,
        },
      });
    }
  }
}

async function main() {
  // Clear in FK-safe order (allocations cascade from expenses). The stock
  // first: its movements hold on to the people who wrote them.
  await prisma.stockChange.deleteMany();
  await prisma.stockEntry.deleteMany();
  await prisma.stockEvent.deleteMany();
  await prisma.stockProductChange.deleteMany();
  await prisma.stockProduct.deleteMany();
  await prisma.expenseEvent.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.bankTransaction.deleteMany();
  await prisma.card.deleteMany();
  await prisma.contract.deleteMany(); // cascades → files, rental → lines
  await prisma.rentalItem.deleteMany();
  await prisma.resultUnit.deleteMany(); // cascades → prefixes
  await prisma.budget.deleteMany(); // cascades cost-centre links → accounts → rows
  await prisma.fortnoxFinancialYear.deleteMany(); // cascades → vouchers → ledger rows
  await prisma.costCenter.deleteMany();
  await prisma.user.deleteMany();

  // Dropping every Receipt row leaves every receipt object in the bucket with
  // nothing pointing at it, so after this wipe the correct contents of
  // `receipts/` is nothing at all, until the seed writes its own below.
  // Without this a dev bucket grows by a full set of orphans per reseed.
  // Storage being down is not a reason to fail a database seed, so this warns
  // and carries on. `pnpm receipts:gc` collects whatever it left behind.
  // The bucket first: a fresh MinIO has none, and the receipts below need it.
  await ensureBucket();
  try {
    const stored = await listObjects("receipts/");
    if (stored.length > 0) {
      const failures = await deleteKeys(stored.map((o) => o.key));
      for (const f of failures) console.error(`kunde inte ta bort ${f.key}: ${f.message}`);
      console.log(`Rensade ${stored.length - failures.length} kvittofiler ur ${bucket()}.`);
    }
  } catch (err) {
    console.warn(`Kunde inte rensa kvittofiler ur ${bucket()}, kör pnpm receipts:gc senare.`, err);
  }

  // ── Users ───────────────────────────────────────────────────────
  // Every distinct person referenced anywhere in the mock data. Roles come from
  // CURRENT_USERS; a cost-centre owner is a resultatansvarig; everyone else
  // referenced defaults to ordinarie.
  const rolesByName = new Map<string, Role[]>();
  for (const u of Object.values(CURRENT_USERS)) rolesByName.set(u.name, u.roles);
  for (const owner of Object.keys(UNIT_OWNERS))
    if (!rolesByName.has(owner)) rolesByName.set(owner, ["RESULTATANSVARIG"]);
  for (const e of EXPENSES) {
    const people = [
      e.submitterName,
      e.bookedBy,
      e.exportedBy,
      e.changesRequested?.by,
      ...e.allocations.map((a) => a.attestedBy),
    ];
    for (const name of people)
      if (name && !rolesByName.has(name)) rolesByName.set(name, ["ORDINARIE"]);
  }

  // The dev sign-in's four have fixed student ids; the rest are derived.
  const studentIdByName = new Map<string, string>(
    Object.values(CURRENT_USERS).map((u) => [u.name, u.studentId]),
  );

  const usersByName = new Map<string, string>(); // name → user id
  for (const [name, roles] of rolesByName) {
    const user = await prisma.user.create({
      data: {
        name,
        studentId: studentIdByName.get(name) ?? studentIdFor(name),
        email: emailFor(name),
        roles,
        ...payoutFor(name),
      },
    });
    usersByName.set(name, user.id);
  }
  const userId = (name: string) => {
    const id = usersByName.get(name);
    if (!id) throw new Error(`No user seeded for "${name}"`);
    return id;
  };

  // ── Cost centres and result units, from the real budget ─────────
  // Every cost centre the section's budget has (scripts/import/budget-2026.json,
  // parsed from VTM-EXTRA.xlsx), and a result unit for each of
  // the workbook's Rambudget headings. A unit's prefix is the letters its codes
  // share (AKTU for AKTU01…AKTU08), which is how membership works for real:
  // see lib/server/result-units.ts.
  const budgetData = loadBudgetJson();
  const costCenterByCode = new Map<string, string>();
  const resultUnitByName = new Map<string, string>();
  const prefixesByUnit = new Map<string, Set<string>>();
  for (const c of budgetData.costCenters) {
    const cc = await prisma.costCenter.create({ data: { code: c.code, name: c.name } });
    costCenterByCode.set(c.code, cc.id);
    if (!c.resultUnit) continue;
    const unit = appUnitName(c.resultUnit);
    const prefix = c.code.replace(/\d+$/, "").toUpperCase();
    prefixesByUnit.set(unit, (prefixesByUnit.get(unit) ?? new Set()).add(prefix));
  }
  for (const [name, prefixes] of prefixesByUnit) {
    const unit = await prisma.resultUnit.create({
      data: { name, prefixes: { create: [...prefixes].map((value) => ({ value })) } },
    });
    resultUnitByName.set(name, unit.id);
  }

  for (const [name, units] of Object.entries(UNIT_OWNERS)) {
    for (const unit of units)
      if (!resultUnitByName.has(unit)) throw new Error(`UNIT_OWNERS names "${unit}", which the budget has no unit for`);
    await prisma.user.update({ where: { id: userId(name) }, data: { resultUnits: units } });
  }

  await prisma.groupRole.deleteMany();
  await prisma.groupResultUnit.deleteMany();
  await prisma.roleCapability.deleteMany();

  await prisma.groupRole.createMany({ data: [...DEFAULT_GROUP_ROLES] });
  await prisma.roleCapability.createMany({ data: [...DEFAULT_ROLE_CAPABILITIES] });

  // Only the units this seed actually created. The defaults name the section's
  // real committees and the fixtures are a smaller, invented set, so most of
  // them have nothing to point at, and a mapping row cannot name a unit that
  // does not exist.
  const groupUnits = DEFAULT_GROUP_RESULT_UNITS.flatMap(({ group, unit }) => {
    const resultUnitId = resultUnitByName.get(unit);
    return resultUnitId ? [{ group, resultUnitId }] : [];
  });
  if (groupUnits.length > 0) await prisma.groupResultUnit.createMany({ data: groupUnits });

  // ── Section cards ───────────────────────────────────────────────
  const cardByHolder = new Map<string, { id: string; last4: string }>();
  const cardIdByLast4 = new Map<string, string>();
  for (const card of CARDS) {
    const created = await prisma.card.create({
      data: {
        last4: card.last4,
        holderId: card.holderName ? userId(card.holderName) : null,
        resultUnitId: card.resultUnit ? (resultUnitByName.get(card.resultUnit) ?? null) : null,
      },
    });
    cardIdByLast4.set(card.last4, created.id);
    if (card.holderName) cardByHolder.set(card.holderName, { id: created.id, last4: card.last4 });
  }

  // ── What the fixtures post to ───────────────────────────────────
  // The chart, the projects and the settings are mirrored from Fortnox or
  // chosen in Inställningar, and a fresh checkout has neither. The seed adds
  // what its utlägg and its ledger use, and leaves anything already there
  // alone, so a dev database synced against Fortnox keeps what it was given.
  const chart = new Map<string, string>();
  for (const c of budgetData.costCenters)
    for (const a of c.accounts) if (!chart.has(a.code)) chart.set(a.code, a.name);
  for (const a of EXTRA_ACCOUNTS) chart.set(a.number, a.name);
  await prisma.account.createMany({
    data: [...chart].map(([number, name]) => ({ number, name })),
    skipDuplicates: true,
  });
  await prisma.project.createMany({ data: [...PROJECTS], skipDuplicates: true });

  // The settings are choices, and these are the fixture's: the BAS accounts a
  // small förening books through. Only where nobody has chosen yet.
  const chosen = await prisma.bookkeepingSettings.findUnique({ where: { id: "singleton" } });
  const settings = {
    bankAccount: chosen?.bankAccount ?? "1930",
    memberDebtAccount: chosen?.memberDebtAccount ?? "2890",
    zettleClearingAccount: chosen?.zettleClearingAccount ?? "1580",
    swishClearingAccount: chosen?.swishClearingAccount ?? "1930",
    zettleFeeAccount: chosen?.zettleFeeAccount ?? "6570",
  };
  await prisma.bookkeepingSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...settings },
    update: settings,
  });
  await prisma.stockSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", expiryLeadDays: 30 },
    update: {},
  });
  const accountNames = new Map(
    (await prisma.account.findMany({ select: { number: true, name: true } })).map((a) => [a.number, a.name]),
  );

  // A milersättning is valued at the rate in force on its day, and there is
  // no default rate (lib/mileage/rate.ts). The fixture's is Skatteverket's
  // schablon, from the start of the earliest year a seeded journey is in.
  const today = stockholmToday();
  const journeyDays = EXPENSES.filter((e) => e.journey).map((e) => dayBefore(today, e.daysAgo));
  const rateRows = async () =>
    (await prisma.mileageRate.findMany()).map((r) => ({
      orePerKm: r.orePerKm,
      validFrom: r.validFrom.toISOString().slice(0, 10),
    }));
  const earliest = journeyDays.sort()[0];
  if (earliest && !rateOn(await rateRows(), earliest)) {
    await prisma.mileageRate.create({
      data: {
        orePerKm: 250,
        validFrom: new Date(`${earliest.slice(0, 4)}-01-01`),
        note: "Skatteverkets schablon, 25 kr per mil",
        createdById: userId(CURRENT_USERS.SKATTMASTARE.name),
      },
    });
  }

  // ── Uthyrningsobjekt ────────────────────────────────────────────
  //
  // The gear catalogue, so a fresh checkout can draw an uthyrningsavtal without
  // somebody first having to invent a speaker. No contracts are seeded: one
  // would carry a signed document. Drawing one is the first thing to try on
  // /contracts.
  await prisma.rentalItem.createMany({ data: [...RENTAL_ITEMS] });

  // ── The budget, and a year of utfall against it ─────────────────
  // Both columns of the workbook, as the importer makes them: the one the
  // section voted through, sealed, so it is the year's budget everywhere a
  // single one is wanted (resolveBudget), and the revision being written
  // beside it.
  const treasurer = userId(CURRENT_USERS.SKATTMASTARE.name);
  const base = { createdById: treasurer, costCenterIds: costCenterByCode };
  const adopted = await buildBudget(prisma, budgetData, {
    ...base,
    name: budgetData.previousName,
    side: "orig",
    lockedAt: new Date(`${budgetData.year}-03-20T18:00:00Z`),
  });
  await buildBudget(prisma, budgetData, { ...base, name: budgetData.name, side: "rev" });
  const bank = { number: settings.bankAccount, name: accountNames.get(settings.bankAccount) ?? "" };
  const ledger = await seedLedger(budgetData, adopted.id, bank);
  await seedStock(treasurer);

  // ── Utlägg ──────────────────────────────────────────────────────
  // After the ledger, so a bokfört utlägg's voucher takes the next number in
  // the series and sits in Utfall beside the rest. See seed-expenses.ts, which
  // also refuses to write any utlägg the app's own rules would not allow.
  const rolesOf = (name: string) => rolesByName.get(name) ?? ["ORDINARIE"];
  const capsOf = (name: string): Capability[] => [
    ...new Set(ROLE_CAPS.filter((rc) => rolesOf(name).includes(rc.role)).map((rc) => rc.capability)),
  ];
  const unitOfCode = new Map<string, string>();
  for (const [unit, prefixes] of prefixesByUnit)
    for (const c of budgetData.costCenters)
      if (prefixes.has(c.code.replace(/\d+$/, "").toUpperCase())) unitOfCode.set(c.code, unit);
  const costCenterNames = new Map(budgetData.costCenters.map((c) => [c.code, c.name]));
  const years = new Map<string, number>([[String(budgetData.year), 1]]);
  let voucherNumber = ledger.lastNumber;

  const { receipts } = await seedExpenses({
    prisma,
    today,
    now: new Date(),
    userId,
    rolesOf,
    capabilitiesOf: capsOf,
    studentIdOf: (name) => studentIdByName.get(name) ?? studentIdFor(name),
    ownedUnitsOf: (name) => UNIT_OWNERS[name] ?? [],
    // Everyone seeded has their payout account filled in (payoutFor).
    hasPayout: (name) => rolesByName.has(name),
    costCenter: (code) => {
      const id = costCenterByCode.get(code);
      return id ? { id, name: costCenterNames.get(code) ?? code, resultUnit: unitOfCode.get(code) ?? null } : undefined;
    },
    cardOf: (name) => cardByHolder.get(name),
    cardByLast4: (last4) => cardIdByLast4.get(last4),
    settings: { bankAccount: settings.bankAccount, memberDebtAccount: settings.memberDebtAccount },
    accountName: (n) => accountNames.get(n),
    projectExists: (n) => PROJECTS.some((p) => p.number === n),
    rates: await rateRows(),
    financialYearFor: async (day) => {
      const year = day.slice(0, 4);
      const known = years.get(year);
      if (known) return known;
      const id = Math.max(...years.values()) + 1;
      await prisma.fortnoxFinancialYear.create({
        data: { id, fromDate: new Date(`${year}-01-01`), toDate: new Date(`${year}-12-31`), lastSyncAt: new Date() },
      });
      years.set(year, id);
      return id;
    },
    nextVoucherNumber: () => (voucherNumber += 1),
  });


  const counts = {
    users: await prisma.user.count(),
    costCenters: await prisma.costCenter.count(),
    bankTransactions: await prisma.bankTransaction.count(),
    cards: await prisma.card.count(),
    expenses: await prisma.expense.count(),
    allocations: await prisma.expenseCostAllocation.count(),
    events: await prisma.expenseEvent.count(),
    rentalItems: await prisma.rentalItem.count(),
    budgets: await prisma.budget.count(),
    stockProducts: await prisma.stockProduct.count(),
    stockEntries: await prisma.stockEntry.count(),
    receipts,
    ledgerRows: ledger.rows,
  };
  console.log("Seeded:", counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
