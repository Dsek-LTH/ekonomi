// Import a bank "Transaktionsrapport" CSV. The browser POSTs the raw file; we
// decode it (Windows-1252), parse rows, auto-create unassigned Card rows for
// any new card numbers, then insert the transactions — skipping ones already
// imported (importHash @unique). Bookkeeper/admin only.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { parseBankCsv } from "@/lib/domain/bank-csv";
import { fail, gate } from "@/lib/api/guard";

const MAX_BYTES = 5 * 1024 * 1024;

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
    await prisma.bankTransaction.createMany({
      data: fresh.map((t) => ({
        bookedDate: new Date(t.bookedDate),
        description: t.description,
        amount: t.amount,
        importHash: t.importHash,
        cardLast4: t.cardLast4 ?? null,
        cardId: t.cardLast4 ? cardIdByLast4.get(t.cardLast4) ?? null : null,
      })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    imported: fresh.length,
    skipped: transactions.length - fresh.length,
    cardsCreated,
    skippedRows,
  });
}
