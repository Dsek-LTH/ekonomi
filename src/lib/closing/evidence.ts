// Which of the app's own vouchers a voucher in the ledger is, and so what
// underlag stands behind it.
//
// The ledger is Fortnox's, mirrored by the SIE sync, and it knows nothing about
// this app. A voucher the app exported says where it went (series, number and
// Fortnox's financial-year id, on Verification), so the two are joined on that.
// Everything else in the ledger was made directly in Fortnox, and the app holds
// no underlag for it.
//
// A number is not a voucher's identity in Fortnox. The latest vouchers in a
// series can be deleted and the numbers used again, so an export recorded as
// A-12 may no longer be what A-12 is. The join is therefore checked against the
// amounts: a match whose total differs from the ledger's is still shown, and
// shown as not agreeing, rather than quietly vouching for a different voucher.

/** How a voucher is named everywhere it is shown, and in its URL: "A-12". */
export const voucherKey = (series: string, number: number) => `${series}-${number}`;

/** "A-12" back into its parts, or null for anything that is not one. */
export function parseVoucherKey(key: string): { series: string; number: number } | null {
  const m = /^([A-Za-z0-9]+)-(\d+)$/.exec(key);
  if (!m) return null;
  return { series: m[1].toUpperCase(), number: Number(m[2]) };
}

/** One of the app's exported vouchers, as much of it as the join needs. */
export interface AppVoucher {
  series: string;
  number: number;
  /** Sum of the voucher's debit lines, in öre. */
  debit: number;
  source:
    | {
        kind: "expense";
        id: string;
        reference: string | null;
        title: string;
        receipts: number;
        /** Filed after the deadline, on a dispens. */
        deadlineWaived: boolean;
        /** Konterat and bokfört by the same person. */
        ownBooking: boolean;
      }
    | { kind: "income"; id: string; date: string };
}

export type VoucherEvidence =
  | (AppVoucher["source"] & {
      /** Whether the app's voucher and the ledger's agree on the total. */
      agrees: boolean;
    })
  | { kind: "none" };

export type EvidenceKind = VoucherEvidence["kind"];

/**
 * Index the app's vouchers for a year by their key.
 *
 * A key can hold more than one: an export the app recorded, a deletion in
 * Fortnox, and a later export given the same number. All are kept, and
 * `evidenceFor` picks between them.
 */
export function indexAppVouchers(vouchers: readonly AppVoucher[]): Map<string, AppVoucher[]> {
  const byKey = new Map<string, AppVoucher[]>();
  for (const v of vouchers) {
    const key = voucherKey(v.series, v.number);
    const list = byKey.get(key) ?? [];
    list.push(v);
    byKey.set(key, list);
  }
  return byKey;
}

/** What underlag stands behind one ledger voucher. */
export function evidenceFor(
  ledger: { series: string; number: number; debit: number },
  index: Map<string, AppVoucher[]>,
): VoucherEvidence {
  const candidates = index.get(voucherKey(ledger.series, ledger.number));
  if (!candidates?.length) return { kind: "none" };
  // The one whose total agrees, when there is one. Otherwise the first, shown
  // as disagreeing: somebody has to look at it either way.
  const agreeing = candidates.find((c) => c.debit === ledger.debit);
  const chosen = agreeing ?? candidates[0];
  return { ...chosen.source, agrees: agreeing !== undefined };
}
