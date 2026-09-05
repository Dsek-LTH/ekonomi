// The parts of "push a voucher to Fortnox" that are the same whatever the
// voucher substantiates.
//
// Two routes do this: api/expenses/[id]/export and
// api/income/reports/[id]/export. They are deliberately the same shape, down to
// the order the two Fortnox calls happen in, and the income one said so in a
// comment at the top of the file rather than in code. Between them they held
// four copies of the same thing: the öre conversion, the row mapping with its
// cost-centre rule, the "needing to log in is a prompt, not a failure" branch,
// the best-effort attach, and the transaction that records the result.
//
// What stays in each route is what actually differs: which row it is about,
// what may be exported, what goes up as the attachment, and what the response
// says.
import "server-only";

import { NextResponse } from "next/server";

import { fail } from "@/lib/api/guard";
import { oreToSEK } from "@/lib/domain/money";
import { prisma } from "@/lib/server/db";
import type { TxClient } from "@/lib/server/tx";
import {
  connectFileToVoucher,
  getUserToken,
  FortnoxAuthRequiredError,
  type CreatedVoucher,
  type VoucherRowInput,
} from ".";

/**
 * How to load a verification so `voucherRows` can read it.
 *
 * Shared so the two routes cannot select differently and then wonder why one
 * of them sends cost centres and the other does not.
 */
export const VOUCHER_INCLUDE = {
  include: { lines: { include: { costCenter: true } } },
} as const;

/** A verification line as both routes load it: with its cost centre attached. */
interface LineWithCostCenter {
  account: string;
  debit: number;
  credit: number;
  description: string | null;
  costCenter: { code: string; source: string } | null;
}

/**
 * A stored verification's lines, as Fortnox takes them.
 *
 * Only a cost centre Fortnox itself knows about travels. A local one is an
 * app-side dimension (it drives attest and the budget) that Fortnox has never
 * heard of, and sending its code would have the whole voucher rejected.
 */
export const voucherRows = (lines: readonly LineWithCostCenter[]): VoucherRowInput[] =>
  lines.map((l) => ({
    account: Number(l.account),
    // Fortnox works in decimal SEK, the database in integer öre. The one pair
    // of converters, per lib/domain/money.ts.
    debit: oreToSEK(l.debit),
    credit: oreToSEK(l.credit),
    costCenter: l.costCenter?.source === "FORTNOX" ? l.costCenter.code : undefined,
    description: l.description ?? undefined,
  }));

/**
 * The bookkeeper's own Fortnox token, or the response to send instead.
 *
 * Their own and not the service account's, so Fortnox attributes the voucher to
 * them by name. This is the whole reason booking lives in the app.
 *
 * Fetched before anything is written, and answered with a 401 carrying
 * `needsFortnoxLogin`, because needing to log in is a prompt the client turns
 * into a button rather than an export that failed.
 */
export async function userToken(
  userId: string,
): Promise<{ ok: true; token: string } | { ok: false; res: NextResponse }> {
  try {
    return { ok: true, token: await getUserToken(userId) };
  } catch (e) {
    if (e instanceof FortnoxAuthRequiredError) {
      return { ok: false, res: fail(401, e.message, { extra: { needsFortnoxLogin: true } }) };
    }
    throw e;
  }
}

/**
 * Attach an already-uploaded file to the voucher, and carry on if it will not.
 *
 * The only step that can run after the voucher exists, and therefore the only
 * one still best effort: a voucher cannot be deleted through the API, so a
 * failure here means attaching the file by hand in Fortnox, not redoing the
 * export. Returns what went wrong, for the client to word beside the success.
 */
export async function attachBestEffort(
  token: string,
  fileId: string | null,
  created: CreatedVoucher,
  label: string,
): Promise<string | null> {
  if (!fileId) return null;
  try {
    await connectFileToVoucher(
      token,
      fileId,
      created.series,
      created.number,
      created.year ?? undefined,
    );
    return null;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[fortnox] ${label}: could not attach the file to the voucher`, e);
    return detail;
  }
}

/**
 * Stamp the voucher's number onto the local verification, and flip the thing it
 * substantiates to EXPORTED.
 *
 * One transaction, because a verification carrying a Fortnox number while its
 * expense still reads BOOKED is a row that will be exported twice.
 */
export async function recordExport(
  verificationId: string,
  created: CreatedVoucher,
  andThen: (tx: TxClient) => Promise<void>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.verification.update({
      where: { id: verificationId },
      data: {
        fortnoxSeries: created.series,
        fortnoxNumber: created.number,
        fortnoxYear: created.year,
        exportedAt: new Date(),
      },
    });
    await andThen(tx);
  });
}
