"use client";

// The three self-contained cards of the review screen's middle column.
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
 * That this day may already have been booked, here as well as in the list,
 * because this is where the decision to book it is actually made.
 *
 * Two separate facts and both are shown: this database holding the verifikation
 * is a different thing from Fortnox holding one for the same source, verksamhet
 * and day. Renders nothing when neither is true.
 */
export function AlreadyBookedNotice({
  report,
  t,
}: {
  report: IncomeReportRow;
  t: Translator;
}) {
  if (!report.duplicateOf && !report.existingVoucher) return null;
  return (
    <Notice>
      {report.duplicateOf && (
        <p>
          {t("review.alreadyBookedWarning")}{" "}
          {report.duplicateOf.voucherLabel && (
            <span className="tabular-nums">{report.duplicateOf.voucherLabel}</span>
          )}
        </p>
      )}
      {report.existingVoucher && (
        <p>{t("review.inFortnoxWarning", { voucher: report.existingVoucher })}</p>
      )}
    </Notice>
  );
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
 * The voucher this day will be posted as, and the button that posts it.
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
  t,
}: {
  voucher: VoucherDraft;
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  onRows: (rows: VoucherEditorRow[]) => void;
  onBook: () => void;
  booking: boolean;
  t: Translator;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("book.title")} />

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
        <BalanceChip balanced={voucher.balanced} difference={formatSEK(voucher.difference)} />
        <div className="flex items-center gap-2.5">
          {/* Why the button is dead: an empty row leaves a balanced voucher
              that still cannot be booked, and without this nothing on the
              screen would admit why. */}
          <VoucherBlockerChip blocker={voucher.blocker} />
          <Button onClick={onBook} loading={booking} disabled={!voucher.canBook}>
            {t("actions.bookAndNext")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
