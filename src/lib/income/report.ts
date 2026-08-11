// Turning a stored report back into the shape the intakt service renders from.
//
// The service is stateless: it computed these reports and forgot them, so
// anything it has to render must be handed back to it. What comes back is not
// quite what it sent — the cost centre may have been corrected in review — which
// is exactly why fetching and rendering are separate calls.
//
// The account distributions are recomputed here rather than stored. They are a
// pure function of the lines (sum by account), so keeping a second copy would
// only create something that could disagree with them — and it is the
// distributions that become the voucher's credit rows, so a disagreement would
// be a voucher that did not match its own evidence.
import type { IncomeAccountDistribution, IncomeFeeReportDto, IncomeReportDto } from "./types";

/** The stored shape this reads. Structural, so it is testable without Prisma. */
export interface StoredReport {
  date: Date;
  total: number;
  /** The verksamhet, by the key intakt files its reports under. */
  resultUnit: { income: { key: string } | null } | null;
  lines: readonly StoredLine[];
}

export interface StoredLine {
  name: string;
  variant: string | null;
  account: string;
  accountName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Sum the lines by account, in account order.
 *
 * Ordered so that the same day always produces the same voucher rows and the
 * same PDF — a Map preserves insertion order, which is line order, and line
 * order is whatever the till happened to ring up.
 */
export function distributionsFor(lines: readonly StoredLine[]): IncomeAccountDistribution[] {
  const byAccount = new Map<string, IncomeAccountDistribution>();
  for (const line of lines) {
    const existing = byAccount.get(line.account);
    if (existing) {
      existing.total += line.total;
    } else {
      byAccount.set(line.account, {
        account: line.account,
        description: line.accountName,
        total: line.total,
      });
    }
  }
  return [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account));
}

export function toReportDto(report: StoredReport): IncomeReportDto {
  const date = isoDate(report.date);
  const committee = report.resultUnit?.income?.key ?? "";
  return {
    key: `${committee}-${date}`,
    committee,
    date,
    total: report.total,
    products: report.lines.map((l) => ({
      name: l.name,
      // Omitted rather than sent as null: the service's field is
      // `variant,omitempty`, and a null would be an explicit empty string in
      // the rendered table instead of no column at all.
      ...(l.variant ? { variant: l.variant } : {}),
      account: l.account,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      effectiveDiscount: l.discount,
      total: l.total,
    })),
    accountDistributions: distributionsFor(report.lines),
  };
}

export function toFeeReportDto(report: StoredReport): IncomeFeeReportDto {
  const date = isoDate(report.date);
  return {
    key: `avgift-${date}`,
    date,
    total: report.total,
    fees: report.lines.map((l) => ({
      name: l.name,
      account: l.account,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      total: l.total,
    })),
  };
}
