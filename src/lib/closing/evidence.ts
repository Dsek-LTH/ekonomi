// Joins the app's exported vouchers to the Fortnox ledger on series, number and financial-year id.
// A number is not a voucher's identity (the latest in a series can be deleted and reused), so a match whose total differs is shown as not agreeing.

export const voucherKey = (series: string, number: number) => `${series}-${number}`;

export function parseVoucherKey(key: string): { series: string; number: number } | null {
  const m = /^([A-Za-z0-9]+)-(\d+)$/.exec(key);
  if (!m) return null;
  return { series: m[1].toUpperCase(), number: Number(m[2]) };
}

export interface AppVoucher {
  series: string;
  number: number;
  debit: number;
  source:
    | {
        kind: "expense";
        id: string;
        reference: string | null;
        title: string;
        receipts: number;
        deadlineWaived: boolean;
        ownBooking: boolean;
      }
    | { kind: "income"; id: string; date: string };
}

export type VoucherEvidence =
  | (AppVoucher["source"] & {
      agrees: boolean;
    })
  | { kind: "none" };

export type EvidenceKind = VoucherEvidence["kind"];

/** Index the app's vouchers for a year by key. A key can hold several (export, deletion in Fortnox, re-export under the same number); `evidenceFor` picks. */
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

export function evidenceFor(
  ledger: { series: string; number: number; debit: number },
  index: Map<string, AppVoucher[]>,
): VoucherEvidence {
  const candidates = index.get(voucherKey(ledger.series, ledger.number));
  if (!candidates?.length) return { kind: "none" };
  // The one whose total agrees, else the first (shown as disagreeing).
  const agreeing = candidates.find((c) => c.debit === ledger.debit);
  const chosen = agreeing ?? candidates[0];
  return { ...chosen.source, agrees: agreeing !== undefined };
}
