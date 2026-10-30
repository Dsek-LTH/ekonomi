"use client";

// Intäkter: every day of takings, the stage as a tab. See page.tsx.
//
// The booked days are the section's record of what it took in, the only
// income state that outlives a fetch. The days still to book are scratch the
// next fetch replaces, and they are booked in the workbench (review-client),
// one at a time, which this list is the way into. Nothing here changes a
// voucher. Once a day is booked the verifikation is what says where the money
// went, and the only step left is pushing it to Fortnox.
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
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { IconDots, IconDownload } from "@/components/ui/icons";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls, useUrlTab } from "@/lib/data/use-list-query";
import { useFormat } from "@/lib/ui/use-format";
import type { IncomeReportRow } from "@/lib/data/income";
import type { IncomeSetupStep } from "@/lib/income/setup";
import type { IncomeReportStatus, IncomeSource } from "@/lib/domain/types";

import { FetchDialog } from "./fetch-panel";
import { IncomeSetupNotice } from "./setup-notice";
import { INCOME_TABS, incomeTabHolds, type IncomeTab } from "./tabs";
import type { FiscalYear } from "@/lib/ui/fiscal-year";

const SOURCES: IncomeSource[] = ["SWISH", "ZETTLE", "ZETTLE_FEE"];

// Which state reads as what. A day still waiting has no business being read as
// done.
const TONE: Record<IncomeReportStatus, "neutral" | "accent" | "success" | "warning"> = {
  DRAFT: "warning",
  BOOKED: "accent",
  EXPORTED: "success",
};

export default function IncomeClient({
  reports,
  tab,
  defaultTab,
  canBook,
  canManage,
  fiscal,
  setup,
  canSetUp,
}: {
  reports: IncomeReportRow[];
  /** The header's räkenskapsår, which narrows every tab. */
  fiscal: FiscalYear | null;
  /** The stage in the URL, or the reader's own. */
  tab: IncomeTab;
  defaultTab: IncomeTab;
  /** May book days, so is offered the way into the workbench. */
  canBook: boolean;
  /**
   * Whether this viewer may undo any of it: unexport, reopen, delete.
   *
   * The narrow treasury gate rather than bookkeeping access, decided on the
   * server where the roles are: undoing an export leaves a voucher in Fortnox
   * that somebody has to go and reverse, and that somebody is who this is.
   */
  canManage: boolean;
  /** What is left to set up before fetching and booking. See lib/income/setup.ts. */
  setup: IncomeSetupStep[];
  /** Holds Inställningar, where most of the setup is done. */
  canSetUp: boolean;
}) {
  const t = useTranslations("income");
  const { date: formatDate } = useFormat();
  const notify = useNotify();
  const { pending, mutate } = useMutation();
  const confirm = useConfirm();
  const router = useProgressRouter();
  const controls = useUrlTab(useTableControls({ tab, sortKey: "date", sortDir: "desc" }), defaultTab);

  // Which day's intäktsräkning the shell's document panel is showing. By id
  // rather than by URL, so the row it belongs to can say so.
  const [viewing, setViewing] = useState<string | null>(null);
  const viewed = reports.find((r) => r.id === viewing);
  const [fetchOpen, setFetchOpen] = useState(false);

  const waiting = reports.filter((r) => r.status === "BOOKED");
  const drafts = reports.filter((r) => r.status === "DRAFT").length;

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
    if (done) router.push(`/income/review?report=${report.id}`);
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

  const tabs: ClientTabFilter<IncomeReportRow> = INCOME_TABS.map((value) => ({
    value,
    label: t(`tab.${value}`),
    predicate: incomeTabHolds(value, fiscal),
  }));

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
      cell: (r) => r.costCenterCode ?? "-",
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
      cell: (r) => (r.voucherLabel ? <span className="tabular-nums">{r.voucherLabel}</span> : "-"),
    },
    {
      // Who approved the day against its intäktsräkning, and when. Every day is
      // reviewed before it is booked, so for a booked day this is never empty,
      // and it is what a revisor asks about a figure first.
      key: "reviewedBy",
      mobile: "hide",
      header: t("table.reviewedBy"),
      value: (r) => r.reviewedByName ?? "",
      sortable: true,
      searchable: true,
      cell: (r) =>
        r.reviewedByName ? (
          <div className="min-w-0">
            <span className="block truncate">{r.reviewedByName}</span>
            {r.reviewedAt && <span className="block text-xs text-muted">{formatDate(r.reviewedAt)}</span>}
          </div>
        ) : (
          "-"
        ),
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
          {/* A day still to book is booked in the workbench, opened at it. Its
              intäktsräkning is drawn there too, from lines that can still
              change, so there is no stored document to show here yet. */}
          {r.status === "DRAFT" ? (
            canBook && (
              <ButtonLink size="sm" href={`/income/review?report=${r.id}`}>
                {t("actions.book")}
              </ButtonLink>
            )
          ) : (
            <Button
              size="sm"
              variant={viewing === r.id ? "secondary" : "ghost"}
              onClick={() => setViewing(viewing === r.id ? null : r.id)}
            >
              {t(viewing === r.id ? "actions.hideDocument" : "actions.viewDocument")}
            </Button>
          )}
          {r.status === "BOOKED" && (
            <Button size="sm" onClick={() => exportOne(r)} loading={pending === `export-${r.id}`}>
              {t("actions.export")}
            </Button>
          )}
          {/* Undoing is the treasury's, and rarer than anything else on the
              row, so it waits behind the menu the way the rest of an utlägg's
              actions do. Delete last and apart: it is the one that cannot be
              taken back. Never offered while a day is exported: unexport it
              first, so leaving Fortnox holding a voucher for takings this app
              forgot is a decision somebody made rather than a side effect. */}
          {canManage && r.status !== "DRAFT" && (
            <Menu
              label={t("actions.more")}
              iconOnly
              variant="ghost"
              size="sm"
              icon={<IconDots className="size-4" />}
              disabled={pending != null && pending.endsWith(r.id)}
            >
              {r.status === "EXPORTED" ? (
                <MenuItem onClick={() => unexport(r)}>{t("undo.unexport")}</MenuItem>
              ) : (
                <>
                  <MenuItem onClick={() => reopen(r)}>{t("undo.reopen")}</MenuItem>
                  <MenuSeparator />
                  <MenuItem onClick={() => remove(r)} className="text-danger">
                    {t("undo.delete")}
                  </MenuItem>
                </>
              )}
            </Menu>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageShell
      title={t("title")}
    >

      {/* The stored intäktsräkning, these bytes, not a fresh render: they are
          what the voucher was booked on and what Fortnox was given. */}
      <ReceiptPanelSource
        documentUrl={viewing ? `/api/income/reports/${viewing}/document` : null}
        mimeType="application/pdf"
        filename={viewed ? `${t(`source.${viewed.source}`)} - ${formatDate(viewed.date)}` : undefined}
      />

      <IncomeSetupNotice steps={setup} canSetUp={canSetUp} />

      {fetchOpen && (
        <FetchDialog ready={setup.every((s) => !s.blocksFetch)} onClose={() => setFetchOpen(false)} />
      )}

      <Card>
        {/* No header of its own: the band and the tabs already say what this
            is, and the table's footer counts it. The way into the workbench
            and the bulk export ride the table's toolbar, with the rows they
            act on, the way every list's own button does. */}
        <ClientDataTable
          action={
            canBook || waiting.length > 0 ? (
              <>
                {/* Here as well as in the workbench, or a list with nothing
                    to book had no way to bring any in. */}
                {canBook && (
                  <Button size="sm" variant="secondary" onClick={() => setFetchOpen(true)}>
                    <IconDownload className="size-4" />
                    {t("fetch.title")}
                  </Button>
                )}
                {canBook && drafts > 0 && (
                  <ButtonLink size="sm" href="/income/review" variant="secondary">
                    {t("list.reviewStart", { count: drafts })}
                  </ButtonLink>
                )}
                {waiting.length > 0 && (
                  <Button size="sm" onClick={exportAll} loading={pending === "exportAll"}>
                    {t("exportAll.action", { count: waiting.length })}
                  </Button>
                )}
              </>
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
          empty={reports.length === 0 ? t("list.empty") : t("empty.noMatch")}
        />
      </Card>
    </PageShell>
  );
}
