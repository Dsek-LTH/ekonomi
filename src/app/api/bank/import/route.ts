// Import a bank "Transaktionsrapport" CSV. The browser POSTs the raw file; we
// decode it (Windows-1252), parse rows, auto-create unassigned Card rows for
// any new card numbers, then insert the transactions, skipping ones already
// imported (importHash @unique). Bookkeeper/admin only.
import { NextResponse } from "next/server";
import { deliverSoon, notify } from "@/lib/server/notify";
import { appUrl, emailT, frame, transactionsBlock } from "@/lib/email/content";
import type { TxClient } from "@/lib/server/tx";
import { prisma } from "@/lib/server/db";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { parseBankCsv } from "@/lib/domain/bank-csv";
import { fail, gate } from "@/lib/api/guard";

const MAX_BYTES = 5 * 1024 * 1024;

// A long statement is a long mail, and past this many lines nobody reads it.
// The rest is one line saying how many more, and the link to all of them.
const MAX_LINES = 30;

/**
 * Tell each card holder what just landed on their card: one mail per holder per
 * import, never one per transaction. Refunds included, since a refund needs an
 * utlägg as much as a purchase does. A card nobody holds yet has nobody to tell;
 * its transactions reach the holder in the Sunday digest once it is assigned.
 *
 * Not the importer excluded, unlike the other notifications: they read a CSV,
 * they did not make the purchases on it.
 */
async function notifyCardHolders(
  tx: TxClient,
  created: { transactionDate: Date; description: string; amount: number; cardId: string | null }[],
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
  const g = await gate(canAccessBookkeeping, "auth.denied");
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

  // Auto-create a Card (no holder) for every card number we haven't seen, so it
  // shows up in admin → Sektionskort ready to assign. Existing cards untouched.
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
          cardId: t.cardLast4 ? cardIdByLast4.get(t.cardLast4) ?? null : null,
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
