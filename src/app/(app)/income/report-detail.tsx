"use client";

// The self-contained cards of the review screen's middle column.
//
// None of them knows anything about the queue beside it or the sales table
// above it. Each is one day and what may be done to it, so each takes what it
// needs and nothing else.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import {
  BalanceChip,
  filledVoucherRows,
  makeVoucherRow,
  VoucherEditor,
  type VoucherEditorRow,
  type VoucherLockedRow,
} from "@/components/voucher-editor";
import { oreToSEK, parseOre, sekToOre } from "@/lib/domain/money";
import type { AccountRecord, CostCenter, ProjectRecord } from "@/lib/domain/types";
import { clearingRow, manualVoucherBlocker } from "@/lib/income/manual-voucher";
import { formatNumber, formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import type { IncomeReportRow } from "@/lib/data/income";
import type { DayVoucher, LineFindings } from "./voucher-draft";

type Translator = (key: string, values?: Record<string, string | number>) => string;

const figure = (kr: number) => (kr ? formatNumber(kr, 2, 2) : "");

/**
 * What to check on this day before approving it.
 *
 * Every day is reviewed against its intäktsräkning, so the review should start
 * with whatever about this one is out of the ordinary: that it may already be
 * booked, here or in Fortnox, that it holds sales the routing could not place,
 * that a line has no cost centre or an archived one, or that a cost centre is
 * local and will reach Fortnox only as text. Each said once, in words.
 *
 * A day with none of those still says so. "Nothing stood out" is itself what
 * the reviewer is being asked to confirm against the document beside it.
 */
export function ReviewFindings({
  report,
  findings,
  t,
}: {
  report: IncomeReportRow;
  findings: LineFindings;
  t: Translator;
}) {
  const said = [
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
    findings.unplaced > 0 && (
      <p key="unplaced">{t("review.findings.unplaced", { count: findings.unplaced })}</p>
    ),
    findings.noCostCenter > 0 && (
      <p key="noCostCenter">
        {t("review.findings.noCostCenter", { count: findings.noCostCenter })}
      </p>
    ),
    findings.inactive.length > 0 && (
      <p key="inactive">{t("review.findings.inactive", { codes: findings.inactive.join(", ") })}</p>
    ),
    findings.local.length > 0 && (
      <p key="local">{t("review.findings.local", { codes: findings.local.join(", ") })}</p>
    ),
  ].filter(Boolean);

  if (said.length === 0) return <Notice tone="info">{t("review.findings.none")}</Notice>;
  return <Notice>{said}</Notice>;
}

/** A row as PUT ../voucher takes it, öre. */
export interface ManualVoucherLine {
  account: string;
  accountName: string;
  description: string | null;
  costCenterCode: string | null;
  project: string | null;
  debit: number;
  credit: number;
}

/**
 * The voucher this day will be posted as, the button that approves and posts
 * it, and the way to write the kontering by hand.
 *
 * Read-only until "Ändra kontering". Then the same editor an utlägg is booked
 * in, with the clearing row locked at the day's total. Saving stores the rows
 * on the server (PUT ../voucher), so nothing edited lives only in this
 * browser. A saved kontering whose lines have changed since says so and blocks
 * booking until it is saved again or reset. The editing state is this card's
 * own and the card is keyed by the day, so moving to another day drops it.
 */
export function VoucherCard({
  report,
  voucher,
  accounts,
  costCenters,
  projects,
  onBook,
  booking,
  onSave,
  onReset,
  saving,
  reviewerName,
  t,
}: {
  report: IncomeReportRow;
  voucher: DayVoucher;
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  projects: ProjectRecord[];
  /** Given, the card carries the button that books the day. The day's own
   *  page has it in its header instead, as an utlägg's record does. */
  onBook?: () => void;
  booking?: boolean;
  /** Save a hand-written kontering. Resolves true when it was saved. */
  onSave: (lines: ManualVoucherLine[]) => Promise<boolean>;
  /** Back to the rows the lines give. */
  onReset: () => void;
  saving: boolean;
  /** Who approving records as the reviewer, and the document as attesting. */
  reviewerName: string;
  t: Translator;
}) {
  const { date: formatDate } = useFormat();
  const [editing, setEditing] = useState<VoucherEditorRow[] | null>(null);

  const total = sekToOre(report.total);
  const side = clearingRow(total);
  const locked: VoucherLockedRow | undefined = side
    ? {
        account: voucher.clearing,
        accountName: accounts.find((a) => a.number === voucher.clearing)?.name ?? voucher.clearing,
        description: t(`source.${report.source}`),
        debit: oreToSEK(side.debit),
        credit: oreToSEK(side.credit),
        hint: t("book.clearingHint"),
        label: t("book.clearingLocked"),
      }
    : undefined;

  /** Start editing from what would be booked now, minus the clearing row. */
  function startEditing() {
    const source = report.manual
      ? report.manual.rows
      : voucher.rows.filter((r) => !(r.account === voucher.clearing && !r.costCenterCode));
    setEditing(
      source.map((r) =>
        makeVoucherRow({
          account: r.account,
          costCenterCode: r.costCenterCode ?? "",
          project: r.project ?? "",
          description: r.description ?? "",
          debit: r.debit ? r.debit.toFixed(2) : "",
          credit: r.credit ? r.credit.toFixed(2) : "",
        }),
      ),
    );
  }

  const lines: ManualVoucherLine[] = editing
    ? filledVoucherRows(editing).map((r) => ({
        account: r.account.trim(),
        accountName: accounts.find((a) => a.number === r.account.trim())?.name ?? "",
        description: r.description.trim() || null,
        costCenterCode: r.costCenterCode.trim() || null,
        project: r.project?.trim() || null,
        debit: parseOre(r.debit),
        credit: parseOre(r.credit),
      }))
    : [];
  const editDebit = lines.reduce((s, l) => s + l.debit, 0) + (side?.debit ?? 0);
  const editCredit = lines.reduce((s, l) => s + l.credit, 0) + (side?.credit ?? 0);
  const editBlocker = editing
    ? manualVoucherBlocker(
        lines.map((l) => ({
          account: l.account,
          costCenter: l.costCenterCode,
          debit: l.debit,
          credit: l.credit,
        })),
        total,
      )
    : null;

  if (editing) {
    return (
      <Card className="overflow-hidden">
        <CardHeader title={t("book.voucherTitle")} subtitle={t("manual.editing")} />
        <VoucherEditor
          rows={editing}
          onChange={setEditing}
          accounts={accounts}
          costCenters={costCenters}
          projects={projects}
          locked={locked}
          totalDebit={oreToSEK(editDebit)}
          totalCredit={oreToSEK(editCredit)}
        />
        <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
          <BalanceChip
            balanced={editDebit === editCredit}
            difference={formatSEK(oreToSEK(editDebit - editCredit))}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            {editBlocker && (
              <span className="text-xs text-warning">{t(`manual.blocker.${editBlocker}`)}</span>
            )}
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              {t("manual.cancel")}
            </Button>
            <Button
              loading={saving}
              disabled={Boolean(editBlocker)}
              onClick={async () => {
                if (await onSave(lines)) setEditing(null);
              }}
            >
              {t("manual.save")}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={t("book.voucherTitle")}
        subtitle={
          report.manual
            ? t("manual.by", {
                name: report.manual.byName ?? "-",
                date: report.manual.at ? formatDate(report.manual.at) : "-",
              })
            : t("book.voucherDerived")
        }
        action={
          <div className="flex items-center gap-2">
            {report.manual && (
              <Button size="sm" variant="ghost" onClick={onReset} loading={saving}>
                {t("manual.reset")}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={startEditing} disabled={saving}>
              {t("manual.edit")}
            </Button>
          </div>
        }
      />
      {report.manual?.stale && (
        <div className="px-inset pb-3">
          <Notice>{t("manual.stale")}</Notice>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-border bg-surface text-left text-xs text-muted">
            <tr>
              <th className="px-inset py-2 font-medium">{t("lines.account")}</th>
              <th className="px-3 py-2 font-medium">{t("lines.costCenter")}</th>
              {report.manual && <th className="px-3 py-2 font-medium">{t("manual.text")}</th>}
              <th className="px-3 py-2 text-right font-medium">{t("book.debit")}</th>
              <th className="px-inset py-2 text-right font-medium">{t("book.credit")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {voucher.rows.map((r, i) => (
              <tr key={`${i}|${r.account}|${r.costCenterCode ?? ""}`}>
                <td className="px-inset py-1.5">
                  <span className="tnum">{r.account || "-"}</span>
                  {r.accountName && r.accountName !== r.account && (
                    <span className="text-muted"> - {r.accountName}</span>
                  )}
                </td>
                <td className="tnum px-3 py-1.5">
                  {r.costCenterCode ?? ""}
                  {r.project && <span className="text-muted"> - {r.project}</span>}
                </td>
                {report.manual && <td className="px-3 py-1.5 text-muted">{r.description ?? ""}</td>}
                <td className="tnum px-3 py-1.5 text-right">{figure(r.debit)}</td>
                <td className="tnum px-inset py-1.5 text-right">{figure(r.credit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border font-medium">
            <tr>
              <td className="px-inset py-2" colSpan={report.manual ? 3 : 2}>
                {t("book.sum")}
              </td>
              <td className="tnum px-3 py-2 text-right">
                {formatNumber(voucher.totalDebit, 2, 2)}
              </td>
              <td className="tnum px-inset py-2 text-right">
                {formatNumber(voucher.totalCredit, 2, 2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
        {/* Approving puts a name on the day and on its document, so the name
            is said beside the button that does it. */}
        <span className="text-xs text-muted">{t("review.konteradAs", { name: reviewerName })}</span>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Why the button is dead, in words, rather than a dead button and
              nothing on the screen admitting why. */}
          {voucher.blocker && (
            <span className="text-xs text-warning">
              {t(`blocker.${voucher.blocker}`, { account: voucher.clearing })}
            </span>
          )}
          {onBook && (
            <Button onClick={onBook} loading={booking} disabled={!voucher.canBook || saving}>
              {t("actions.kontera")}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
