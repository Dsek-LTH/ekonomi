// Seeds the database from the mockup's static data (lib/mock-data.ts) so the
// real app starts with the same scenarios the design was validated against.
// Idempotent: wipes the domain tables and re-inserts on every run.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type ExpenseEventType, type Role } from "../src/lib/generated/prisma/client";

// Standalone run (pnpm db:seed) — load .env ourselves.
process.loadEnvFile?.(".env");
import { bucket, deleteKeys, listObjects } from "./storage-admin";
import {
  BANK_TRANSACTIONS,
  CARDS,
  COST_CENTERS,
  CURRENT_USERS,
  EXPENSES,
} from "./seed-data";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// öre — store money as integer minor units.
const ore = (sek: number) => Math.round(sek * 100);

// "Elsa Lindqvist" → "elsa.lindqvist@user.dsek.se"
const emailFor = (name: string) =>
  name
    .toLowerCase()
    .replace(/å|ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/\s+/g, ".") + "@user.dsek.se";

// Map the mockup's free-text revision actions to typed audit events.
const EVENT_TYPE: Record<string, ExpenseEventType> = {
  "Skapade utlägget": "CREATED",
  "Fyllde i kvittouppgifter": "EDITED",
  "Matchade mot banktransaktion": "MATCHED",
  "Skickade in för attest": "SUBMITTED",
  "Begärde ändring": "CHANGES_REQUESTED",
  "Attesterade utlägget": "APPROVED",
  "Bokförde utlägget": "BOOKED",
  "Exporterade till Fortnox": "EXPORTED",
};

async function main() {
  // Clear in FK-safe order (allocations cascade from expenses).
  await prisma.expenseEvent.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.bankTransaction.deleteMany();
  await prisma.card.deleteMany();
  await prisma.resultUnitOwner.deleteMany();
  await prisma.budget.deleteMany(); // cascades cost-centre links → accounts → rows
  await prisma.costCenter.deleteMany();
  await prisma.user.deleteMany();

  // Dropping every Receipt row leaves every receipt object in the bucket with
  // nothing pointing at it, and the seed data brings no files of its own — so
  // after this wipe the correct contents of `receipts/` is nothing at all.
  // Without this a dev bucket grows by a full set of orphans per reseed.
  // Storage being down is not a reason to fail a database seed, so this warns
  // and carries on — `pnpm receipts:gc` collects whatever it left behind.
  try {
    const stored = await listObjects("receipts/");
    if (stored.length > 0) {
      const failures = await deleteKeys(stored.map((o) => o.key));
      for (const f of failures) console.error(`kunde inte ta bort ${f.key}: ${f.message}`);
      console.log(`Rensade ${stored.length - failures.length} kvittofiler ur ${bucket()}.`);
    }
  } catch (err) {
    console.warn(`Kunde inte rensa kvittofiler ur ${bucket()} — kör pnpm receipts:gc senare.`, err);
  }

  // ── Users ───────────────────────────────────────────────────────
  // Every distinct person referenced anywhere in the mock data. Roles come from
  // CURRENT_USERS; a cost-centre owner is a resultatansvarig; everyone else
  // referenced defaults to ordinarie.
  const rolesByName = new Map<string, Role[]>();
  for (const u of Object.values(CURRENT_USERS)) rolesByName.set(u.name, u.roles);
  for (const c of COST_CENTERS)
    if (c.ownerName && !rolesByName.has(c.ownerName))
      rolesByName.set(c.ownerName, ["RESULTATANSVARIG"]);
  for (const e of EXPENSES) {
    if (!rolesByName.has(e.submitterName)) rolesByName.set(e.submitterName, ["ORDINARIE"]);
    for (const r of e.revisions)
      if (!rolesByName.has(r.actor)) rolesByName.set(r.actor, ["ORDINARIE"]);
  }

  const usersByName = new Map<string, string>(); // name → user id
  for (const [name, roles] of rolesByName) {
    const user = await prisma.user.create({
      data: { name, email: emailFor(name), roles },
    });
    usersByName.set(name, user.id);
  }
  const userId = (name: string) => {
    const id = usersByName.get(name);
    if (!id) throw new Error(`No user seeded for "${name}"`);
    return id;
  };

  // ── Cost centers (+ result units and their ownerships) ───────────
  // ResultUnit membership is derived from code prefixes, so each seeded
  // result unit gets its cost centre's full code as its prefix — matching that
  // one code and nothing else.
  const costCenterByCode = new Map<string, string>();
  const resultUnitByName = new Map<string, string>();
  const ownerships = new Set<string>(); // "userId|resultUnitId" dedupe
  for (const c of COST_CENTERS) {
    const cc = await prisma.costCenter.create({
      data: { code: c.code, name: c.name },
    });
    costCenterByCode.set(c.code, cc.id);
    if (!c.resultUnit) continue;

    let resultUnitId = resultUnitByName.get(c.resultUnit);
    if (!resultUnitId) {
      const resultUnit = await prisma.resultUnit.create({
        data: {
          name: c.resultUnit,
          prefixes: { create: [{ value: c.code.toUpperCase() }] },
        },
      });
      resultUnitId = resultUnit.id;
      resultUnitByName.set(c.resultUnit, resultUnitId);
    } else {
      // A second cost centre under the same result unit adds its own prefix.
      await prisma.resultUnitPrefix.create({
        data: { resultUnitId, value: c.code.toUpperCase() },
      });
    }

    if (c.ownerName) {
      const key = `${userId(c.ownerName)}|${resultUnitId}`;
      if (!ownerships.has(key)) {
        ownerships.add(key);
        await prisma.resultUnitOwner.create({
          data: { userId: userId(c.ownerName), resultUnitId },
        });
      }
    }
  }

  // ── Bank transactions ───────────────────────────────────────────
  const txByMockId = new Map<string, string>(); // mock "t3" → real id
  for (const t of BANK_TRANSACTIONS) {
    const tx = await prisma.bankTransaction.create({
      data: {
        bookedDate: new Date(t.bookedDate),
        description: t.description,
        amount: ore(t.amount),
      },
    });
    txByMockId.set(t.id, tx.id);
  }

  // ── Section cards ───────────────────────────────────────────────
  for (const card of CARDS) {
    const created = await prisma.card.create({
      data: {
        last4: card.last4,
        holderId: card.holderName ? userId(card.holderName) : null,
      },
    });
    for (const tid of card.transactionIds) {
      const txId = txByMockId.get(tid);
      if (txId) {
        await prisma.bankTransaction.update({
          where: { id: txId },
          data: { cardId: created.id, cardLast4: card.last4 },
        });
      }
    }
  }

  // ── Expenses (+ allocations + events) ──────────────────────────
  for (const e of EXPENSES) {
    const created = await prisma.expense.create({
      data: {
        reference: e.id,
        title: e.title,
        submitterId: userId(e.submitterName),
        paymentType: e.paymentType,
        status: e.status,
        purchaseDate: new Date(e.purchaseDate),
        grossAmount: ore(e.grossAmount),
        currency: e.currency,
        matchedTransactionId: e.matchedTransactionId
          ? txByMockId.get(e.matchedTransactionId)
          : null,
        events: {
          create: e.revisions.map((r) => ({
            type: EVENT_TYPE[r.action] ?? "EDITED",
            actorId: userId(r.actor),
            comment: r.comment ?? null,
            createdAt: new Date(r.date),
          })),
        },
      },
    });
    for (const a of e.allocations) {
      const ccId = costCenterByCode.get(a.costCenterCode);
      if (!ccId) throw new Error(`Unknown cost center code "${a.costCenterCode}" in expense ${e.id}`);
      await prisma.expenseCostAllocation.create({
        data: {
          expenseId: created.id,
          costCenterId: ccId,
          amount: ore(a.amount),
        },
      });
    }
  }

  const counts = {
    users: await prisma.user.count(),
    costCenters: await prisma.costCenter.count(),
    bankTransactions: await prisma.bankTransaction.count(),
    cards: await prisma.card.count(),
    expenses: await prisma.expense.count(),
    allocations: await prisma.expenseCostAllocation.count(),
    events: await prisma.expenseEvent.count(),
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
