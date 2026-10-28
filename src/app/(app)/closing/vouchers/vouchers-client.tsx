"use client";

import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  type Column,
  type SelectFilter,
  type TabFilter,
} from "@/components/ui/data-table";
import { IconComment } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Tag } from "@/components/ui/status-pill";
import { useUrlTableControls } from "@/lib/data/use-list-query";
import type { RowPage } from "@/lib/data/list-query";
import type {
  ClosingProgress,
  ClosingTab,
  ClosingVoucher,
  ClosingYear,
} from "@/lib/data/closing";
import { VOUCHER_FLAGS } from "@/lib/closing/flags";
import { REVIEW_PASSES, REVIEW_PICKS, type ReviewPass } from "@/lib/closing/review";
import { useFormat } from "@/lib/ui/use-format";
import { EvidenceTag } from "../evidence-cell";
import { ReviewTag } from "../review-tag";
import { closingSections } from "../sections";

export default function ClosingVouchersClient({
  year,
  page,
  counts,
  progress,
  filterPass,
}: {
  year: ClosingYear;
  page: RowPage<ClosingVoucher>;
  counts: Record<ClosingTab, number>;
  progress: ClosingProgress;
  /** The pass the review filter asks about. */
  filterPass: ReviewPass;
}) {
  const t = useTranslations("closing");
  const tReview = useTranslations("closing.review");
  const tFlag = useTranslations("closing.flag");
  const { date, dateTime } = useFormat();
  const controls = useUrlTableControls(page.total);

  const tab = (value: ClosingTab) => ({ value, label: t(`tab.${value}`), badge: counts[value] });
  const tabs: TabFilter = [
    { value: "all", label: t("tab.all") },
    tab("expense"),
    tab("income"),
    tab("none"),
    // Only while there is something under it. Most years there should be
    // nothing, and an empty tab reads as one more thing to check.
    ...(counts.disagrees > 0 ? [tab("disagrees")] : []),
  ];

  const filters: SelectFilter[] = [
    {
      label: tReview("filter", { pass: tReview(`pass.${filterPass}`) }),
      options: REVIEW_PICKS.map((p) => ({
        value: `review:${p}`,
        label: tReview(`status.${p}`),
      })),
    },
    {
      label: tFlag("filter"),
      options: VOUCHER_FLAGS.map((f) => ({ value: `flag:${f}`, label: tFlag(f) })),
    },
  ];

  const columns: Column<ClosingVoucher>[] = [
    {
      key: "number",
      header: t("col.voucher"),
      sortable: true,
      mobile: "title",
      className: "whitespace-nowrap",
      cell: (v) => <span className="font-medium tabular-nums">{v.key}</span>,
    },
    {
      key: "date",
      header: t("col.date"),
      sortable: true,
      dateRange: true,
      value: (v) => v.date,
      mobile: "meta",
      className: "whitespace-nowrap",
      cell: (v) => date(v.date),
    },
    {
      key: "description",
      header: t("col.description"),
      mobile: "meta",
      cell: (v) => (
        <span className="flex flex-col gap-1">
          <span className="break-words">{v.description}</span>
          {v.flags.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {v.flags.map((f) => (
                <Tag key={f} tone="warning" size="sm">
                  {tFlag(f)}
                </Tag>
              ))}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "evidence",
      header: t("col.evidence"),
      mobile: "status",
      cell: (v) => <EvidenceTag evidence={v.evidence} />,
    },
    ...REVIEW_PASSES.map(
      (p): Column<ClosingVoucher> => ({
        key: `review-${p}`,
        header: tReview(`pass.${p}`),
        mobile: "status",
        cell: (v) => <ReviewTag state={v.review[p]} />,
      }),
    ),
    {
      key: "comments",
      header: <span className="sr-only">{t("col.comments")}</span>,
      align: "right",
      mobile: "meta",
      cell: (v) =>
        v.comments > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-muted"
            title={t("commentCount", { count: v.comments })}
          >
            <IconComment className="size-4" />
            {v.comments}
          </span>
        ) : null,
    },
    {
      key: "amount",
      header: t("col.amount"),
      align: "right",
      sortable: true,
      mobile: "trailing",
      className: "whitespace-nowrap",
      cell: (v) => <Amount value={v.amount} />,
    },
  ];

  // How far each pass has got, over the whole year rather than the filtered
  // view: it is the question "are we done", which a filter does not change.
  const summary = (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {REVIEW_PASSES.map((p) => (
        <span key={p}>
          {tReview("progress", {
            pass: tReview(`pass.${p}`),
            settled: progress.settled[p],
            total: progress.total,
          })}
          {progress.questions[p] > 0 &&
            `, ${tReview("openQuestions", { count: progress.questions[p] })}`}
        </span>
      ))}
    </span>
  );

  return (
    <PageShell
      title={t("yearTitle", { year: year.year })}
      subtitle={
        year.lastSyncAt ? t("lastSync", { when: dateTime(year.lastSyncAt) }) : t("neverSynced")
      }
      pages={closingSections({
        active: "vouchers",
        label: t("sections.label"),
        labels: {
          checklist: t("sections.checklist"),
          vouchers: t("sections.vouchers"),
          accounts: t("sections.accounts"),
        },
      })}
    >
      <div className="flex flex-col gap-4">
        {progress.orphaned > 0 && (
          <Notice tone="warning">{tReview("orphaned", { count: progress.orphaned })}</Notice>
        )}
        <Card>
          <DataTable
            columns={columns}
            rows={page.rows}
            controls={controls}
            tabs={tabs}
            filter={filters}
            summary={summary}
            searchPlaceholder={t("search")}
            rowKey={(v) => v.key}
            rowHref={(v) => `/closing/vouchers/${v.key}`}
            empty={t("noMatch")}
          />
        </Card>
      </div>
    </PageShell>
  );
}
