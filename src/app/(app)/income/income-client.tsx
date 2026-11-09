"use client";

// One of Intäkter's two lists, Zettle or Swish: every day of takings, the
// stage as a tab, the way Utlägg is (docs/navigation.md).
//
// A row opens the day's own page (./[source]/[id]), where it is konterad, and
// later granskad and bokförd by somebody else. Nothing is worked in the list
// itself beyond what is the same for many days at once: konterar every day
// that needs nobody, and bokför every konterad day the reader may granska.
// The days that need somebody say why in the Behöver dig column.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { IconDots, IconDownload, IconUpload } from "@/components/ui/icons";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls, useUrlTab } from "@/lib/data/use-list-query";
import { useFormat } from "@/lib/ui/use-format";
import type { IncomeReportRow } from "@/lib/data/income";
import type { IncomeSettingsRow } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter, ProjectRecord } from "@/lib/domain/types";
import type { IncomeSetupStep } from "@/lib/income/setup";
import { incomeDayHref, type IncomeSourceSlug } from "@/lib/income/source-slug";
import type { FiscalYear } from "@/lib/ui/fiscal-year";

import { FetchDialog, FetchPanel } from "./fetch-panel";
import { IncomeSetupNotice } from "./setup-notice";
import { INCOME_TABS, incomeTabHolds, type IncomeTab } from "./tabs";
import { dayVoucher, lineFindings } from "./voucher-draft";

export default function IncomeClient({
  slug,
  reports,
  tab,
  defaultTab,
  canBook,
  canManage,
  viewerId,
  exemptOwn,
  settings,
  accounts,
  costCenters,
  projects,
  fiscal,
  setup,
  canSetUp,
}: {
  slug: IncomeSourceSlug;
  reports: IncomeReportRow[];
  tab: IncomeTab;
  defaultTab: IncomeTab;
  /** May fetch, kontera and bokföra. */
  canBook: boolean;
  /** May undo: unexport, reopen, delete a booked day. Drafts any bookkeeper may delete. */
  canManage: boolean;
  viewerId: string;
  /** Past the two-person rule (REVIEW_OWN_BOOKING). */
  exemptOwn: boolean;
  settings: IncomeSettingsRow;
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  projects: ProjectRecord[];
  fiscal: FiscalYear | null;
  setup: IncomeSetupStep[];
  canSetUp: boolean;
}) {
  const t = useTranslations("income");
  const { date: formatDate } = useFormat();
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const controls = useUrlTab(
    useTableControls({ tab, sortKey: "date", sortDir: "desc" }),
    defaultTab,
  );
  const [fetchOpen, setFetchOpen] = useState(false);
  const source = slug === "swish" ? "SWISH" : "ZETTLE";
  const ready = setup.every((s) => !s.blocksFetch);

  const voucherOf = (r: IncomeReportRow) =>
    dayVoucher({ report: r, settings, accounts, costCenters, projects });
  const own = (r: IncomeReportRow) => !exemptOwn && r.bookedBy.includes(viewerId);

  // What the two bulk actions act on: days nobody needs to look at, and
  // konterade days this reader may granska.
  const clean = reports.filter((r) => {
    if (r.status !== "DRAFT" || r.legacy) return false;
    const f = lineFindings(r, costCenters);
    return voucherOf(r).canBook && f.unplaced === 0 && !r.existingVoucher;
  });
  const reviewable = reports.filter((r) => r.status === "BOOKED" && !own(r));

  /**
   * Many days one at a time, in date order, stopping at the first that fails:
   * a failure halfway reads as "these went, that one stopped it" rather than
   * as fifty requests in flight with no account of them.
   */
  async function runAll(days: IncomeReportRow[], step: "book" | "export", key: string) {
    let done = 0;
    for (const r of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
      const ok = await mutate(`/api/income/reports/${r.id}/${step}`, {
        key,
        body: {},
        error: t(step === "book" ? "bookFailed" : "exportFailed"),
        refresh: false,
      });
      if (!ok) break;
      done++;
    }
    notify.success(t(`bulk.${step}Done`, { count: done, total: days.length }));
    window.location.reload();
  }

  async function unexport(r: IncomeReportRow) {
    const ok = await confirm({
      title: t("undo.unexportTitle"),
      message: t("undo.unexportBody", { voucher: r.voucherLabel ?? "" }),
      confirmLabel: t("undo.unexportConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/income/reports/${r.id}/unexport`, {
      key: `unexport-${r.id}`,
      error: t("undo.failed"),
      success: t("undo.unexportDone"),
    });
  }

  async function reopen(r: IncomeReportRow) {
    const ok = await confirm({
      title: t("undo.reopenTitle"),
      message: t("undo.reopenBody"),
      confirmLabel: t("undo.reopenConfirm"),
    });
    if (!ok) return;
    await mutate(`/api/income/reports/${r.id}/reopen`, {
      key: `reopen-${r.id}`,
      error: t("undo.failed"),
      success: t("undo.reopenDone"),
    });
  }

  async function remove(r: IncomeReportRow) {
    const ok = await confirm({
      title: t("undo.deleteTitle", { date: formatDate(r.date) }),
      message: t("undo.deleteBody", { unit: r.unitNames.join(", ") || t(`source.${r.source}`) }),
      confirmLabel: t("undo.deleteConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/income/reports/${r.id}`, {
      key: `delete-${r.id}`,
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

  /** What a day still needs, in words, or that it needs nothing. */
  function needs(r: IncomeReportRow) {
    if (r.status === "EXPORTED") {
      return r.voucherLabel ? <span className="tabular-nums">{r.voucherLabel}</span> : "-";
    }
    if (r.status === "BOOKED") {
      return (
        <span className="text-muted">
          {t("list.bookedBy", { name: r.reviewedByName ?? "-" })}
          {own(r) && ` - ${t("list.ownBooking")}`}
        </span>
      );
    }
    const f = lineFindings(r, costCenters);
    const v = voucherOf(r);
    const tags = [
      r.duplicateOf && (
        <Tag key="d" tone="warning">
          {t("review.alreadyBookedShort")}
        </Tag>
      ),
      r.existingVoucher && (
        <Tag key="e" tone="warning">
          {t("review.inFortnox", { voucher: r.existingVoucher })}
        </Tag>
      ),
      f.unplaced > 0 && (
        <Tag key="u" tone="warning">
          {t("review.unplacedShort", { count: f.unplaced })}
        </Tag>
      ),
      f.noCostCenter > 0 && (
        <Tag key="c" tone="warning">
          {t("review.noCostCenterShort", { count: f.noCostCenter })}
        </Tag>
      ),
      r.manual?.stale && (
        <Tag key="m" tone="warning">
          {t("list.manualStale")}
        </Tag>
      ),
    ].filter(Boolean);
    if (tags.length > 0) return <span className="flex flex-wrap gap-1">{tags}</span>;
    if (v.blocker)
      return (
        <span className="text-xs text-warning">
          {t(`blocker.${v.blocker}`, { account: v.clearing })}
        </span>
      );
    return <Tag tone="success">{t("list.ready")}</Tag>;
  }

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
      key: "units",
      header: t("table.units"),
      value: (r) => r.unitNames.join(", "),
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (r) => (
        <span className="block truncate font-medium">
          {r.unitNames.join(", ") || (r.source === "ZETTLE_FEE" ? t("table.fees") : "-")}
        </span>
      ),
    },
    {
      key: "costCenter",
      mobile: "hide",
      header: t("table.costCenter"),
      value: (r) => r.costCenterCodes.join(", "),
      searchable: true,
      className: "tabular-nums",
      cell: (r) => <span className="block truncate">{r.costCenterCodes.join(", ") || "-"}</span>,
    },
    {
      key: "needs",
      mobile: "status",
      header: t("table.needs"),
      value: (r) => r.status,
      cell: needs,
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
      cell: (r) => {
        const canDelete = r.status === "DRAFT" ? canBook : canManage && r.status === "BOOKED";
        const canUnexport = canManage && r.status === "EXPORTED";
        const canReopen = canManage && r.status === "BOOKED" && !r.legacy;
        if (!canDelete && !canUnexport && !canReopen) return null;
        return (
          <Menu
            label={t("actions.more")}
            iconOnly
            variant="ghost"
            size="sm"
            icon={<IconDots className="size-4" />}
            disabled={pending != null && pending.endsWith(r.id)}
          >
            {canUnexport && <MenuItem onClick={() => unexport(r)}>{t("undo.unexport")}</MenuItem>}
            {canReopen && <MenuItem onClick={() => reopen(r)}>{t("undo.reopen")}</MenuItem>}
            {canReopen && canDelete && <MenuSeparator />}
            {canDelete && (
              <MenuItem onClick={() => remove(r)} className="text-danger">
                {t("undo.delete")}
              </MenuItem>
            )}
          </Menu>
        );
      },
    },
  ];

  const FetchIcon = source === "SWISH" ? IconUpload : IconDownload;

  return (
    <PageShell title={t(`page.${slug}`)}>
      <IncomeSetupNotice steps={setup} canSetUp={canSetUp} />

      {fetchOpen && (
        <FetchDialog source={source} ready={ready} onClose={() => setFetchOpen(false)} />
      )}

      {reports.length === 0 && canBook ? (
        // Nothing yet, so bringing days in is the only thing to do here, and
        // the form is the page rather than a dialog behind a button.
        <FetchPanel
          source={source}
          ready={ready}
          title={t(source === "SWISH" ? "fetch.titleSwish" : "fetch.titleZettle")}
          subtitle={t("fetch.description")}
        />
      ) : (
        <Card>
          <ClientDataTable
            action={
              canBook ? (
                <>
                  {controls.tab === "book" && clean.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => runAll(clean, "book", "bookAll")}
                      loading={pending === "bookAll"}
                    >
                      {t("bulk.book", { count: clean.length })}
                    </Button>
                  )}
                  {controls.tab === "export" && reviewable.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => runAll(reviewable, "export", "exportAll")}
                      loading={pending === "exportAll"}
                    >
                      {t("bulk.export", { count: reviewable.length })}
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setFetchOpen(true)} data-guide="list-action">
                    <FetchIcon className="size-4" />
                    {t(source === "SWISH" ? "fetch.titleSwish" : "fetch.titleZettle")}
                  </Button>
                </>
              ) : undefined
            }
            columns={columns}
            rows={reports}
            controls={controls}
            tabs={tabs}
            searchPlaceholder={t("booked.searchPlaceholder")}
            rowKey={(r) => r.id}
            rowHref={incomeDayHref}
            empty={t("empty.noMatch")}
          />
        </Card>
      )}
    </PageShell>
  );
}
