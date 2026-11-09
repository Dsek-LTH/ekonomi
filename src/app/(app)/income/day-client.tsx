"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { InspectorSection, StripCell, VoucherTable } from "@/components/record-card";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconDots } from "@/components/ui/icons";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Tag } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import type {
  IncomeLineRow,
  IncomeMoveTarget,
  IncomeReportRow,
  IncomeVoucherRow,
} from "@/lib/data/income";
import type { IncomeSettingsRow } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter, ProjectRecord } from "@/lib/domain/types";
import { incomeVoucherDescription } from "@/lib/income/voucher";
import { incomeListHref, slugOf } from "@/lib/income/source-slug";

import { accountOptions, MoveLinesDialog, type AssignRequest } from "./move-dialog";
import { ReviewFindings, VoucherCard, type ManualVoucherLine } from "./report-detail";
import { SoldLinesTable } from "./sold-lines-table";
import { tabOf } from "./tabs";
import { dayVoucher, documentUrl, lineFindings } from "./voucher-draft";

const TONE = { DRAFT: "warning", BOOKED: "accent", EXPORTED: "success" } as const;

export default function DayClient({
  report,
  voucherRows,
  settings,
  costCenters,
  accounts,
  projects,
  moveTargets,
  canBook,
  canManage,
  ownBooking,
  reviewerName,
}: {
  report: IncomeReportRow;
  voucherRows: IncomeVoucherRow[] | null;
  settings: IncomeSettingsRow;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  projects: ProjectRecord[];
  moveTargets: IncomeMoveTarget[];
  canBook: boolean;
  canManage: boolean;
  ownBooking: boolean;
  reviewerName: string;
}) {
  const t = useTranslations("income");
  const { date: formatDate } = useFormat();
  const router = useProgressRouter();
  const confirm = useConfirm();
  const { pending, busy, mutate } = useMutation();
  const [selection, setSelection] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);

  const slug = slugOf(report.source);
  const draft = report.status === "DRAFT";
  const editable = draft && canBook && !report.legacy;
  const voucher = dayVoucher({ report, settings, accounts, costCenters, projects });
  const findings = lineFindings(report, costCenters);
  const back = (status = report.status) => router.push(incomeListHref(slug, tabOf(status)));

  async function kontera() {
    const done = await mutate(`/api/income/reports/${report.id}/book`, {
      key: "book",
      body: {},
      error: t("bookFailed"),
      success: t("bookDone"),
      refresh: false,
    });
    if (done) back("DRAFT");
  }

  async function bokfor() {
    const done = await mutate(`/api/income/reports/${report.id}/export`, {
      key: "export",
      body: {},
      error: t("exportFailed"),
      success: t("exportDone"),
      refresh: false,
    });
    if (done) back("BOOKED");
  }

  async function undo(path: "unexport" | "reopen", confirmKey: "unexport" | "reopen") {
    const ok = await confirm({
      title: t(`undo.${confirmKey}Title`),
      message: t(`undo.${confirmKey}Body`, { voucher: report.voucherLabel ?? "" }),
      confirmLabel: t(`undo.${confirmKey}Confirm`),
      tone: path === "unexport" ? "danger" : undefined,
    });
    if (!ok) return;
    await mutate(`/api/income/reports/${report.id}/${path}`, {
      key: path,
      error: t("undo.failed"),
      success: t(`undo.${path}Done`),
    });
  }

  async function remove() {
    const ok = await confirm({
      title: t("undo.deleteTitle", { date: formatDate(report.date) }),
      message: t("undo.deleteBody", {
        unit: report.unitNames.join(", ") || t(`source.${report.source}`),
      }),
      confirmLabel: t("undo.deleteConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    const done = await mutate(`/api/income/reports/${report.id}`, {
      key: "delete",
      method: "DELETE",
      error: t("undo.failed"),
      success: t("undo.deleteDone"),
      refresh: false,
    });
    if (done) back();
  }

  async function patchLines(lines: object[], key: string) {
    return mutate(`/api/income/reports/${report.id}/lines`, {
      key,
      method: "PATCH",
      body: { lines },
      error: t("lines.saveFailed"),
    });
  }

  const costCenterId = (code: string) => costCenters.find((c) => c.code === code)?.id ?? null;

  async function saveVoucher(lines: ManualVoucherLine[]) {
    return Boolean(
      await mutate(`/api/income/reports/${report.id}/voucher`, {
        key: "voucher",
        method: "PUT",
        body: { lines },
        error: t("manual.saveFailed"),
        success: t("manual.saved"),
      }),
    );
  }

  async function resetVoucher() {
    await mutate(`/api/income/reports/${report.id}/voucher`, {
      key: "voucher",
      method: "DELETE",
      error: t("manual.saveFailed"),
      success: t("manual.resetDone"),
    });
  }

  async function assign(request: AssignRequest) {
    if (await patchLines(request.lines, "assign")) {
      setSelection([]);
      setAssigning(false);
    }
  }

  type Action = {
    key: string;
    label: string;
    onClick: () => void;
    disabledReason?: string | null;
    danger?: boolean;
  };
  const lead: Action | null =
    canBook && draft && !report.legacy
      ? {
          key: "book",
          label: t("actions.kontera"),
          onClick: () => void kontera(),
          disabledReason: voucher.blocker
            ? t(`blocker.${voucher.blocker}`, { account: voucher.clearing })
            : null,
        }
      : canBook && report.status === "BOOKED"
        ? {
            key: "export",
            label: t("actions.review"),
            onClick: () => void bokfor(),
            disabledReason: ownBooking ? t("list.ownBookingHint") : null,
          }
        : null;
  const menu = (
    [
      canManage &&
        report.status === "BOOKED" &&
        !report.legacy && {
          key: "reopen",
          label: t("undo.reopen"),
          onClick: () => void undo("reopen", "reopen"),
        },
      canManage &&
        report.status === "EXPORTED" && {
          key: "unexport",
          label: t("undo.unexport"),
          onClick: () => void undo("unexport", "unexport"),
        },
      ((draft && canBook) || (canManage && report.status === "BOOKED")) && {
        key: "delete",
        label: t("undo.delete"),
        onClick: () => void remove(),
        danger: true,
      },
    ] as (Action | false)[]
  ).filter((a): a is Action => a !== false);

  const linesTable = (
    <SoldLinesTable
      lines={report.lines}
      readOnly={!editable}
      picked={selection}
      onPick={setSelection}
      onAssign={(ids) => {
        setSelection(ids);
        setAssigning(true);
      }}
      accountOptionsFor={(line: IncomeLineRow) =>
        accountOptions(
          moveTargets.find((u) => u.resultUnitId === line.resultUnitId),
          accounts,
          t("move.unknownAccountName"),
        )
      }
      costCenterOptions={costCenters
        .filter((c) => c.active)
        .map((c) => ({ value: c.code, label: `${c.code} - ${c.name}`, short: c.code }))}
      ownCostCenters={(unitId) =>
        moveTargets.find((u) => u.resultUnitId === unitId)?.costCenterCodes ??
        (unitId === null && settings.zettleFeeCostCenterCode
          ? [settings.zettleFeeCostCenterCode]
          : [])
      }
      inactiveCodes={costCenters.filter((c) => !c.active).map((c) => c.code)}
      onAccount={(ids, account) =>
        void patchLines(
          ids.map((id) => ({ id, account })),
          "account",
        )
      }
      onCostCenter={(ids, code) =>
        void patchLines(
          ids.map((id) => ({ id, costCenterId: costCenterId(code) })),
          "costCenter",
        )
      }
      busy={busy}
      t={t}
    />
  );

  return (
    <PageShell
      title={`${t(`source.${report.source}`)} ${formatDate(report.date)}`}
      back={incomeListHref(slug)}
    >
      <ReceiptPanelSource
        documentUrl={report.lines.length > 0 || !draft ? documentUrl(report) : null}
        mimeType="application/pdf"
        filename={`${t(`source.${report.source}`)} - ${formatDate(report.date)}`}
      />

      <div className="@container min-w-0 space-y-4">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-inset py-4">
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Tag tone={TONE[report.status]}>{t(`status.${report.status}`)}</Tag>
              {report.legacy && <span className="text-xs text-muted">{t("day.legacy")}</span>}
            </div>
            <div className="flex w-full items-center gap-2.5 sm:w-auto">
              {lead &&
                (lead.disabledReason ? (
                  <Tooltip
                    label={lead.disabledReason}
                    align="start"
                    className="flex-1 sm:flex-none"
                  >
                    <Button disabled className="w-full">
                      {lead.label}
                      <span className="sr-only">{`. ${lead.disabledReason}`}</span>
                    </Button>
                  </Tooltip>
                ) : (
                  <Button
                    loading={pending === lead.key}
                    disabled={busy}
                    onClick={lead.onClick}
                    className="flex-1 sm:flex-none"
                  >
                    {lead.label}
                  </Button>
                ))}
              {menu.length > 0 && (
                <Menu
                  label={t("actions.more")}
                  variant="secondary"
                  disabled={busy}
                  compact
                  icon={lead ? <IconDots className="size-4 sm:hidden" /> : undefined}
                  className="shrink-0"
                >
                  {menu.map((a, i) => (
                    <Fragment key={a.key}>
                      {a.danger && i > 0 && <MenuSeparator />}
                      <MenuItem
                        onClick={a.onClick}
                        className={a.danger ? "text-danger" : undefined}
                      >
                        {a.label}
                      </MenuItem>
                    </Fragment>
                  ))}
                </Menu>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
            <StripCell label={t("day.total")} className="col-span-2 sm:col-span-1" truncate>
              <span className="text-base font-semibold tabular-nums">
                {formatSEK(report.total)}
              </span>
            </StripCell>
            <StripCell label={t("day.text")} truncate>
              {report.legacy ? "-" : incomeVoucherDescription(report.source)}
            </StripCell>
            <StripCell label={t("day.bookedBy")} truncate>
              {report.reviewedByName ? (
                <>
                  {report.reviewedByName}
                  {report.reviewedAt && (
                    <span className="ml-1.5 text-muted">{formatDate(report.reviewedAt)}</span>
                  )}
                </>
              ) : (
                <span className="text-muted">-</span>
              )}
            </StripCell>
            <StripCell label={t("table.voucher")} truncate>
              {report.voucherLabel ?? <span className="text-muted">-</span>}
            </StripCell>
          </div>

          {voucherRows && (
            <InspectorSection title={t("book.voucherTitle")} flush endsInTable>
              <VoucherTable
                lines={voucherRows.map((r, i) => ({
                  key: `${i}`,
                  account: r.account,
                  accountName: r.accountName,
                  costCenter: r.costCenterCode,
                  project: r.project,
                  note: r.description ?? undefined,
                  debit: r.debit,
                  credit: r.credit,
                }))}
              />
            </InspectorSection>
          )}
        </Card>

        {editable && <ReviewFindings report={report} findings={findings} t={t} />}

        {linesTable}

        {editable && (
          <VoucherCard
            report={report}
            voucher={voucher}
            accounts={accounts}
            costCenters={costCenters.filter((c) => c.active)}
            projects={projects}
            onSave={saveVoucher}
            onReset={() => void resetVoucher()}
            saving={pending === "voucher"}
            reviewerName={reviewerName}
            t={t}
          />
        )}
      </div>

      {assigning && (
        <MoveLinesDialog
          lines={report.lines.filter((l) => selection.includes(l.id))}
          targets={moveTargets}
          accounts={accounts}
          busy={pending === "assign"}
          onCancel={() => setAssigning(false)}
          onMove={(request) => void assign(request)}
        />
      )}
    </PageShell>
  );
}
