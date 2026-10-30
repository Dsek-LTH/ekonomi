"use client";

// The self-contained cards of the review screen's middle column.
//
// None of them knows anything about the queue beside it or the sales table
// under it. Each is one report and what may be done to it, so each takes what
// it needs and nothing else. They were inline in review-client.tsx, where being
// self-contained was true and impossible to see.
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import {
  BalanceChip,
  VoucherBlockerChip,
  VoucherEditor,
  type VoucherEditorRow,
} from "@/components/voucher-editor";
import { formatSEK } from "@/lib/ui/format";
import type { IncomeReportRow } from "@/lib/data/income";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";
import type { VoucherDraft } from "./voucher-draft";

type Translator = (key: string, values?: Record<string, string | number>) => string;

/**
 * What to check on this day before approving it.
 *
 * Every day is reviewed one at a time against its intäktsräkning, so the
 * review should start with whatever about this one is out of the ordinary:
 * that it may already be booked, here or in Fortnox, that it holds the sales
 * the routing could not place, that it has no cost centre, or that its voucher
 * was changed by hand. Each said once, in words, where the decision is made.
 *
 * A day with none of those still says so, rather than showing nothing. "Nothing
 * stood out" is itself what the reviewer is being asked to confirm against the
 * document beside it.
 */
export function ReviewFindings({
  report,
  isFallback,
  noCostCentre,
  edited,
  t,
}: {
  report: IncomeReportRow;
  /** The day belongs to the reserv, where unplaced sales go. */
  isFallback: boolean;
  noCostCentre: boolean;
  edited: boolean;
  t: Translator;
}) {
  const findings = [
    report.duplicateOf && (
      <p key="duplicate">
        {t("review.alreadyBookedWarning")}{" "}
        {report.duplicateOf.voucherLabel && (
          <span className="tabular-nums">{report.duplicateOf.voucherLabel}</span>
        )}
      </p>
    ),
    report.existingVoucher && (
      <p key="fortnox">{t("review.inFortnoxWarning", { voucher: report.existingVoucher })}</p>
    ),
    isFallback && report.lines.length > 0 && <p key="fallback">{t("review.findings.fallback")}</p>,
    noCostCentre && <p key="costCentre">{t("review.findings.noCostCentre")}</p>,
    edited && <p key="edited">{t("review.findings.edited")}</p>,
  ].filter(Boolean);

  if (findings.length === 0) return <Notice tone="info">{t("review.findings.none")}</Notice>;
  return <Notice>{findings}</Notice>;
}

/**
 * A report made by hand and not yet filled: created for a verksamhet the
 * routing produced no day for, so that a fallback day belonging to two of them
 * can be split in two.
 *
 * Neither the voucher nor the sold-lines table is shown for one, because both
 * are derived from lines it has none of. What it says instead is what to do
 * with it.
 */
export function EmptyReportCard({
  t,
  onDelete,
  deleting,
}: {
  t: Translator;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <Card>
      <CardHeader title={t("newReport.emptyTitle")} />
      <CardBody className="space-y-4">
        <Notice tone="info">{t("newReport.emptyBody")}</Notice>
        <div className="flex justify-end">
          <Button variant="dangerOutline" onClick={onDelete} loading={deleting}>
            {t("newReport.delete")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * The voucher this day will be posted as, and the button that approves and
 * posts it.
 *
 * The header no longer repeats the verksamhet or the date. Those are the two
 * cards above it, the picker that sets the one and the locked field that states
 * the other.
 */
export function VoucherCard({
  voucher,
  accounts,
  costCenters,
  onRows,
  onBook,
  booking,
  reviewerName,
  t,
}: {
  voucher: VoucherDraft;
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  onRows: (rows: VoucherEditorRow[]) => void;
  onBook: () => void;
  booking: boolean;
  /** Who approving records as the reviewer, and the document as attesting. */
  reviewerName: string;
  t: Translator;
}) {
  return (
    <Card className="overflow-hidden">
      <VoucherEditor
        rows={voucher.rows}
        onChange={onRows}
        accounts={accounts}
        costCenters={costCenters}
        locked={voucher.locked}
        totalDebit={voucher.totalDebit}
        totalCredit={voucher.totalCredit}
      />

      {/* The rows' own unknowns are named by the editor; this one is about the
          locked row, and it is fixed somewhere else, so it says where. */}
      {!voucher.clearingKnown && (
        <div className="px-inset pb-4">
          <Notice>{t("book.unknownClearingAccount", { account: voucher.clearing })}</Notice>
        </div>
      )}

      <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <BalanceChip balanced={voucher.balanced} difference={formatSEK(voucher.difference)} />
          {/* Approving puts a name on the day and on its document, so the
              name is said beside the button that does it. */}
          <span className="text-xs text-muted">{t("review.approvedAs", { name: reviewerName })}</span>
        </div>
        <div className="flex items-center gap-2.5">
          {/* Why the button is dead: an empty row leaves a balanced voucher
              that still cannot be booked, and without this nothing on the
              screen would admit why. */}
          <VoucherBlockerChip blocker={voucher.blocker} />
          <Button
            onClick={onBook}
            loading={booking}
            disabled={!voucher.canBook}
            title={t("review.approveShortcut")}
          >
            {t("actions.bookAndNext")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
