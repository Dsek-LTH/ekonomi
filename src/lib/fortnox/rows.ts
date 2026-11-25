// The rows every export sends Fortnox, built from what ekonomi stored. Pure, so the rule about
// which cost centre may travel as one is tested on its own (rows.test.ts). Used by
// api/expenses/[id]/export, api/income/reports/[id]/export, lib/server/stock-posting.ts and
// api/supplier-invoices/[id]/export.
import { exportRowCostCenter, type ExportCostCenter } from "@/lib/domain/cost-center-tag";
import { oreToSEK } from "@/lib/domain/money";
import type { VoucherRowInput } from ".";

interface LineWithCostCenter {
  account: string;
  debit: number;
  credit: number;
  description: string | null;
  costCenter: ExportCostCenter | null;
  project?: string | null;
}

/**
 * A verification's lines as Fortnox takes them. The cost centre goes by the shared rule
 * (exportRowCostCenter in lib/domain/cost-center-tag): one Fortnox cannot take goes into the row
 * text instead.
 */
export const voucherRows = (lines: readonly LineWithCostCenter[]): VoucherRowInput[] =>
  lines.map((l) => {
    const row = exportRowCostCenter(l.costCenter?.code, l.costCenter, l.description ?? "");
    return {
      account: Number(l.account),
      // Fortnox takes decimal SEK, the database holds integer öre (lib/domain/money.ts).
      debit: oreToSEK(l.debit),
      credit: oreToSEK(l.credit),
      costCenter: row.costCenter,
      project: l.project || undefined,
      description: row.text || undefined,
    };
  });

/**
 * A levfaktura's kontering as Fortnox's supplier invoice rows. Its lines hold the cost centre as a
 * plain code, so `register` (the cost centres by code) says what each one is, and the same rule as
 * a voucher's applies: a local code, an inactive one or one the register does not know goes into
 * the row text instead of getting the whole invoice rejected.
 */
export const supplierInvoiceRows = (
  lines: readonly {
    account: string;
    debit: number;
    credit: number;
    costCenterCode: string | null;
    project: string | null;
    description: string | null;
  }[],
  register: ReadonlyMap<string, ExportCostCenter>,
) =>
  lines.map((l) => {
    const code = l.costCenterCode || null;
    const row = exportRowCostCenter(code, code ? register.get(code) : null, l.description ?? "");
    return {
      account: Number(l.account),
      debit: oreToSEK(l.debit),
      credit: oreToSEK(l.credit),
      costCenter: row.costCenter,
      project: l.project ?? undefined,
      text: row.text || undefined,
    };
  });
