"use client";

// Bokfört och exporterat: the section's record of what it took in.
//
// The durable half, and the only income state that outlives a fetch. What is
// waiting to be booked is scratch that the next fetch replaces (see
// review-client). So this is the answer to "did we book 3 September, and is it
// in Fortnox yet".
//
// A different job from the review queue:
// reading rather than deciding, often at a different time and by a different
// person. Nothing here changes a voucher. Once a day is booked the
// verifikation is what says where the money went, and the only step left is
// pushing it to Fortnox.
//
// A table rather than the workbench's three columns, for the same reason Bank
// is a table: hundreds of rows nobody needs to open, scanned for the few that
// still want something.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls } from "@/lib/data/use-list-query";
import { useFormat } from "@/lib/ui/use-format";
import type { IncomeReportRow } from "@/lib/data/income";
import type { IncomeReportStatus, IncomeSource } from "@/lib/domain/types";

import { incomeSections } from "../sections";

const SOURCES: IncomeSource[] = ["SWISH", "ZETTLE", "ZETTLE_FEE"];

// Which state reads as what. This list is the booked half, so DRAFT is the odd
// one out. A day still waiting has no business being read as done.
const TONE: Record<IncomeReportStatus, "neutral" | "accent" | "success" | "warning"> = {
  DRAFT: "warning",
  BOOKED: "accent",
  EXPORTED: "success",
};

export default function BookedClient({
  reports,
  canManage,
}: {
  reports: IncomeReportRow[];
  /**
   * Whether this viewer may undo any of it: unexport, reopen, delete.
   *
   * The narrow treasury gate rather than bookkeeping access, decided on the
   * server where the roles are: undoing an export leaves a voucher in Fortnox
   * that somebody has to go and reverse, and that somebody is who this is.
   */
  canManage: boolean;
}) {
  const t = useTranslations("income");
  const { date: formatDate } = useFormat();
  const notify = useNotify();
  const { pending, mutate } = useMutation();
  const confirm = useConfirm();
  const router = useProgressRouter();
  const controls = useTableControls({ sortKey: "date", sortDir: "desc" });

  // Which day's intäktsräkning the shell's document panel is showing. By id
  // rather than by URL, so the row it belongs to can say so.
  const [viewing, setViewing] = useState<string | null>(null);
  const viewed = reports.find((r) => r.id === viewing);

  const waiting = reports.filter((r) => r.status === "BOOKED");

  async function exportOne(report: IncomeReportRow) {
    await mutate(`/api/income/reports/${report.id}/export`, {
      key: `export-${report.id}`,
      error: t("exportFailed"),
      success: t("exportDone"),
    });
  }

  /**
   * Push every booked day to Fortnox, one at a time and in order.
   *
   * Sequential for the same reason booking is: each export uploads a PDF and
   * creates a voucher with the bookkeeper's own Fortnox login, and a failure
   * halfway should read as "these are over there, that one stopped it" rather
   * than as fifty requests in flight with no account of them.
   */
  async function exportAll() {
    let done = 0;
    for (const report of waiting) {
      const result = await mutate(`/api/income/reports/${report.id}/export`, {
        key: "exportAll",
        error: t("exportFailed"),
        refresh: false,
      });
      if (!result) break;
      done++;
    }
    notify.success(t("exportAll.done", { count: done, total: waiting.length }));
    window.location.reload();
  }

  /**
   * Undo an export: this app forgets the Fortnox voucher, Fortnox keeps it.
   *
   * Said plainly in the confirmation, because it is the whole risk: exporting
   * again writes a *second* voucher for the same takings unless someone
   * reverses the first over there by hand.
   */
  async function unexport(report: IncomeReportRow) {
    const ok = await confirm({
      title: t("undo.unexportTitle"),
      message: t("undo.unexportBody", { voucher: report.voucherLabel ?? "" }),
      confirmLabel: t("undo.unexportConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/income/reports/${report.id}/unexport`, {
      key: `unexport-${report.id}`,
      error: t("undo.failed"),
      success: t("undo.unexportDone"),
    });
  }

  /**
   * Take a booked day apart and hand it back to the review queue.
   *
   * It becomes an ordinary draft there, waiting to be booked again, and swept
   * away by the next fetch like any other, which is what "unbooked" should mean
   * for a day whose takings the next fetch will bring back anyway.
   */
  async function reopen(report: IncomeReportRow) {
    const ok = await confirm({
      title: t("undo.reopenTitle"),
      message: t("undo.reopenBody"),
      confirmLabel: t("undo.reopenConfirm"),
    });
    if (!ok) return;
    const done = await mutate(`/api/income/reports/${report.id}/reopen`, {
      key: `reopen-${report.id}`,
      error: t("undo.failed"),
    });
    if (done) router.push(`/income?report=${report.id}`);
  }

  /** Remove a day entirely: the report, its sold lines and its verifikation. */
  async function remove(report: IncomeReportRow) {
    const ok = await confirm({
      title: t("undo.deleteTitle", { date: formatDate(report.date) }),
      message: t("undo.deleteBody", { unit: report.unitName ?? t("table.fees") }),
      confirmLabel: t("undo.deleteConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/income/reports/${report.id}`, {
      key: `delete-${report.id}`,
      method: "DELETE",
      error: t("undo.failed"),
      success: t("undo.deleteDone"),
    });
  }

  const tabs: ClientTabFilter<IncomeReportRow> = [
    { value: "ALL", label: t("tab.all") },
    { value: "BOOKED", label: t("status.BOOKED"), predicate: (r) => r.status === "BOOKED" },
    { value: "EXPORTED", label: t("status.EXPORTED"), predicate: (r) => r.status === "EXPORTED" },
  ];

  const columns: Column<IncomeReportRow>[] = [
    {
      key: "date",
      mobile: "meta",
      mobileOrder: 1,
      header: t("table.date"),
      value: (r) => r.date,
      sortable: true,
      dateRange: true,
      className: "whitespace-nowrap",
      cell: (r) => formatDate(r.date),
    },
    {
      key: "committee",
      header: t("table.committee"),
      value: (r) => r.unitName ?? t("table.fees"),
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-medium">{r.unitName ?? t("table.fees")}</span>
          <span className="block text-xs text-muted">{t(`source.${r.source}`)}</span>
        </div>
      ),
    },
    {
      key: "costCenter",
      mobile: "meta",
      header: t("table.costCenter"),
      value: (r) => r.costCenterCode ?? "",
      sortable: true,
      searchable: true,
      className: "tabular-nums",
      cell: (r) => r.costCenterCode ?? "–",
    },
    {
      key: "status",
      mobile: "status",
      header: t("table.status"),
      value: (r) => r.status,
      sortable: true,
      cell: (r) => <Tag tone={TONE[r.status]}>{t(`status.${r.status}`)}</Tag>,
    },
    {
      key: "voucher",
      mobile: "hide",
      header: t("table.voucher"),
      value: (r) => r.voucherLabel ?? "",
      sortable: true,
      searchable: true,
      cell: (r) => (r.voucherLabel ? <span className="tabular-nums">{r.voucherLabel}</span> : "–"),
    },
    {
      key: "total",
      header: t("table.total"),
      value: (r) => r.total,
      sortable: true,
      align: "right",
      mobile: "trailing",
      cell: (r) => <Amount value={r.total} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant={viewing === r.id ? "secondary" : "ghost"}
            onClick={() => setViewing(viewing === r.id ? null : r.id)}
          >
            {t(viewing === r.id ? "actions.hideDocument" : "actions.viewDocument")}
          </Button>
          {canManage && r.status === "EXPORTED" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => unexport(r)}
              loading={pending === `unexport-${r.id}`}
            >
              {t("undo.unexport")}
            </Button>
          )}
          {canManage && r.status === "BOOKED" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => reopen(r)}
              loading={pending === `reopen-${r.id}`}
            >
              {t("undo.reopen")}
            </Button>
          )}
          {/* Never while it is exported: unexport it first, so leaving Fortnox
              holding a voucher for takings this app forgot is a decision
              somebody made rather than a side effect. */}
          {canManage && r.status !== "EXPORTED" && (
            <Button
              size="sm"
              variant="dangerOutline"
              onClick={() => remove(r)}
              loading={pending === `delete-${r.id}`}
            >
              {t("undo.delete")}
            </Button>
          )}
          {r.status === "BOOKED" && (
            <Button size="sm" onClick={() => exportOne(r)} loading={pending === `export-${r.id}`}>
              {t("actions.export")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageShell
      title={t("booked.title")}
      collections={incomeSections({
        active: "booked",
        label: t("nav.label"),
        labels: { review: t("nav.review"), booked: t("nav.booked") },
        counts: { booked: waiting.length },
      })}
    >

      {/* The stored intäktsräkning, these bytes, not a fresh render: they are
          what the voucher was booked on and what Fortnox was given. */}
      <ReceiptPanelSource
        documentUrl={viewing ? `/api/income/reports/${viewing}/document` : null}
        mimeType="application/pdf"
        filename={viewed ? `${t(`source.${viewed.source}`)} – ${formatDate(viewed.date)}` : undefined}
      />

      <Card>
        {/* No header of its own: the tabs and the switch above already say
            this is Bokfört och exporterat, and the table's footer counts it.
            The bulk export rides the table's toolbar, with the rows it acts on,
            the way every list's own button does. */}
        <ClientDataTable
          action={
            waiting.length > 0 ? (
              <Button size="sm" onClick={exportAll} loading={pending === "exportAll"}>
                {t("exportAll.action", { count: waiting.length })}
              </Button>
            ) : undefined
          }
          columns={columns}
          rows={reports}
          controls={controls}
          tabs={tabs}
          filter={{
            label: t("table.source"),
            options: SOURCES.map((s) => ({
              value: s,
              label: t(`source.${s}`),
              predicate: (r: IncomeReportRow) => r.source === s,
            })),
          }}
          searchPlaceholder={t("booked.searchPlaceholder")}
          rowKey={(r) => r.id}
          empty={reports.length === 0 ? t("booked.empty") : t("empty.noMatch")}
        />
      </Card>
    </PageShell>
  );
}
