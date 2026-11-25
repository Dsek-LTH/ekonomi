// Shared parts of pushing a voucher to Fortnox, used by api/expenses/[id]/export and
// api/income/reports/[id]/export (keep their call order the same).
import "server-only";

import { NextResponse } from "next/server";

import { fail } from "@/lib/api/guard";
import { prisma } from "@/lib/server/db";
import type { TxClient } from "@/lib/server/tx";
import {
  connectFileToVoucher,
  getUserToken,
  FortnoxAuthRequiredError,
  type CreatedVoucher,
} from ".";

/** How to load a verification so `voucherRows` can read it. */
export const VOUCHER_INCLUDE = {
  include: { lines: { include: { costCenter: true } } },
} as const;

/**
 * The bookkeeper's own Fortnox token (so the voucher carries their name), or the response
 * to send instead: a 401 with `needsFortnoxLogin`, which the client shows as a login prompt.
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
 * Attach an uploaded file to the voucher, best effort: a voucher cannot be deleted through
 * the API, so a failure means attaching by hand. Returns what went wrong.
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
 * Stamp the Fortnox number on the verification and flip the substantiated item to EXPORTED,
 * in one transaction so nothing is exported twice.
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
