// What the section owes one member, for the dashboard of somebody who is not
// answering for anyone's budget. Their own money is the figure they came for.
//
// Only out of pocket: an eget utlägg or a milersättning. A card purchase was
// paid by the section, so nothing on it is coming back to anyone.
//
// There is no "paid" state. Exporterat is the last one, and the FAQ says the
// money goes out from there. So what is on its way is everything sent in and
// not yet exported, and the exported is reported as sent for payout rather
// than as paid, which this app cannot see.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { oreToSEK } from "@/lib/domain/money";
import type { ExpenseStatus } from "@/lib/domain/types";

export interface MoneyStage {
  count: number;
  /** SEK. */
  amount: number;
}

export interface MyMoney {
  /** Sent in and waiting on attest, or sent back to be fixed. */
  awaitingAttest: MoneyStage;
  /** Attested or booked, not yet in Fortnox. */
  approved: MoneyStage;
  /** Exported this year: in Fortnox, and paid out from there. */
  exportedThisYear: MoneyStage;
}

const STAGE: Partial<Record<ExpenseStatus, Exclude<keyof MyMoney, "exportedThisYear">>> = {
  PENDING_APPROVAL: "awaitingAttest",
  CHANGES_REQUESTED: "awaitingAttest",
  APPROVED: "approved",
  BOOKED: "approved",
};

export async function getMyMoney(userId: string, year: number): Promise<MyMoney> {
  const outOfPocket: Prisma.ExpenseWhereInput = {
    submitterId: userId,
    paymentType: { in: ["REIMBURSEMENT", "MILEAGE"] },
  };
  const [open, exported] = await Promise.all([
    prisma.expense.groupBy({
      by: ["status"],
      where: { ...outOfPocket, status: { in: Object.keys(STAGE) as ExpenseStatus[] } },
      _sum: { grossAmount: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: {
        ...outOfPocket,
        status: "EXPORTED",
        purchaseDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      _sum: { grossAmount: true },
      _count: true,
    }),
  ]);

  const out: MyMoney = {
    awaitingAttest: { count: 0, amount: 0 },
    approved: { count: 0, amount: 0 },
    exportedThisYear: { count: exported._count, amount: oreToSEK(exported._sum.grossAmount) },
  };
  for (const g of open) {
    const stage = STAGE[g.status];
    if (!stage) continue;
    out[stage].count += g._count;
    out[stage].amount += oreToSEK(g._sum.grossAmount);
  }
  return out;
}
