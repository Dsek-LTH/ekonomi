// Import a bank "Transaktionsrapport" CSV (Windows-1252), auto-creating unassigned Cards and skipping rows
// already imported (importHash @unique). Bookkeeper/admin only.
import { NextResponse } from "next/server";
import { deliverSoon, notify } from "@/lib/server/notify";
import { appUrl, emailT, frame, transactionsBlock } from "@/lib/email/content";
import type { TxClient } from "@/lib/server/tx";
import { prisma } from "@/lib/server/db";
import { canBookkeep } from "@/lib/domain/permissions";
import { parseBankCsv } from "@/lib/domain/bank-csv";
import { fail, gate } from "@/lib/api/guard";

const MAX_BYTES = 5 * 1024 * 1024;

// Past this many lines the mail says how many more, with a link.
const MAX_LINES = 30;

/**
 * One mail per card holder per import, refunds included. A card nobody holds has nobody to tell (the Sunday digest
 * covers it once assigned). The importer is not excluded, unlike other notifications: they read a CSV, they did not make the purchases.
 */
async function notifyCardHolders(
  tx: TxClient,
  created: {
    transactionDate: Date;
    description: string;
    amount: number;
    cardId: string | null;
  }[],
) {
  const cardIds = [...new Set(created.map((t) => t.cardId).filter((c): c is string => !!c))];
  if (cardIds.length === 0) return;
  const cards = await tx.card.findMany({
    where: { id: { in: cardIds }, holderId: { not: null } },
    select: { id: true, last4: true, holderId: true },
  });

  const byHolder = new Map<string, { last4: string[]; txns: typeof created }>();
  for (const card of cards) {
    const entry = byHolder.get(card.holderId!) ?? { last4: [], txns: [] };
    entry.last4.push(card.last4);
    entry.txns.push(...created.filter((t) => t.cardId === card.id));
    byHolder.set(card.holderId!, entry);
  }

  const url = appUrl("/bank?scope=mine");
  for (const [holderId, { last4, txns }] of byHolder) {
    const count = txns.length;
    const cards = last4.map((l) => emailT("cardMask", { last4: l })).join(", ");
    await notify(tx, "CARD_TRANSACTIONS_IMPORTED", [holderId], {
      subject: emailT("cardTransactions.subject", { count }),
      tone: "card",
      eyebrow: emailT("cardTransactions.eyebrow", { cards }),
      heading: emailT("cardTransactions.heading", { count }),
      intro: emailT("cardTransactions.intro"),
      blocks: [transactionsBlock(txns, MAX_LINES)],
      action: { label: emailT("cardTransactions.button"), url },
      orOpen: emailT("orOpen", { url }),
      ...frame(emailT("reason.cardHolder", { cards })),
    });
  }
}

export async function POST(req: Request) {
  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength === 0) return fail(400, "bank.emptyFile");
  if (buf.byteLength > MAX_BYTES) return fail(413, "bank.fileTooLarge");

  // Bank export is Windows-1252; latin1 decodes the Swedish characters here.
  const text = buf.toString("latin1");
  const { transactions, cardLast4s, skippedRows } = parseBankCsv(text);

  if (transactions.length === 0) {
    return fail(422, "bank.noTransactions");
  }

  // Auto-create a holderless Card for every new card number, ready to assign in admin → Sektionskort.
  const existingCards = await prisma.card.findMany({
    where: { last4: { in: cardLast4s } },
    select: { id: true, last4: true },
  });
  const cardIdByLast4 = new Map(existingCards.map((c) => [c.last4, c.id]));
  let cardsCreated = 0;
  for (const last4 of cardLast4s) {
    if (cardIdByLast4.has(last4)) continue;
    const created = await prisma.card.create({
      data: { last4 },
    });
    cardIdByLast4.set(last4, created.id);
    cardsCreated++;
  }

  // Skip transactions already imported (matched on importHash).
  const hashes = transactions.map((t) => t.importHash);
  const existing = await prisma.bankTransaction.findMany({
    where: { importHash: { in: hashes } },
    select: { importHash: true },
  });
  const known = new Set(existing.map((e) => e.importHash));
  const fresh = transactions.filter((t) => !known.has(t.importHash));

  if (fresh.length > 0) {
    await prisma.$transaction(async (tx) => {
      const created = await tx.bankTransaction.createManyAndReturn({
        data: fresh.map((t) => ({
          transactionDate: new Date(t.transactionDate),
          description: t.description,
          amount: t.amount,
          importHash: t.importHash,
          cardLast4: t.cardLast4 ?? null,
          cardId: t.cardLast4 ? (cardIdByLast4.get(t.cardLast4) ?? null) : null,
        })),
        skipDuplicates: true,
        select: { transactionDate: true, description: true, amount: true, cardId: true },
      });
      await notifyCardHolders(tx, created);
    });
    deliverSoon();
  }

  return NextResponse.json({
    imported: fresh.length,
    skipped: transactions.length - fresh.length,
    cardsCreated,
    skippedRows,
  });
}
