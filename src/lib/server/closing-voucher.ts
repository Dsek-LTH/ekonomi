// What the bokslut routes share: finding the voucher a URL names, and holding a
// write to the version of it the screen was showing.
import "server-only";

import type { NextResponse } from "next/server";
import { fail } from "@/lib/api/guard";
import { parseVoucherKey } from "@/lib/closing/evidence";
import { voucherFingerprintNow } from "@/lib/data/closing";

export type ResolvedVoucher =
  | { ok: true; financialYear: number; series: string; number: number }
  | { ok: false; res: NextResponse };

/**
 * The voucher `/api/closing/[year]/vouchers/[voucher]` names, provided it is still the version `seenHash`
 * describes. A 409 otherwise (changed in Fortnox meanwhile), so a write is never recorded against an unseen voucher.
 */
export async function resolveVoucher(
  params: { year: string; voucher: string },
  seenHash: string,
): Promise<ResolvedVoucher> {
  const financialYear = Number(params.year);
  const ref = parseVoucherKey(decodeURIComponent(params.voucher));
  if (!Number.isInteger(financialYear) || !ref) {
    return { ok: false, res: fail(404, "closing.voucherNotFound") };
  }
  const now = await voucherFingerprintNow(financialYear, ref);
  if (!now) return { ok: false, res: fail(404, "closing.voucherNotFound") };
  if (now.contentHash !== seenHash) return { ok: false, res: fail(409, "closing.voucherChanged") };
  // The series as the ledger spells it, so every row about this voucher agrees.
  return { ok: true, financialYear, series: now.series, number: ref.number };
}
