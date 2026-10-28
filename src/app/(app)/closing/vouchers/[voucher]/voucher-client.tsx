"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { useMutation } from "@/components/shell/use-mutation";
import { Amount } from "@/components/ui/amount";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls } from "@/lib/data/use-list-query";
import type { ClosingVoucherDetail, ClosingVoucherRow, ClosingYear } from "@/lib/data/closing";
import type { ReviewVoucherBody, VoucherCommentBody } from "@/lib/api/schemas/closing";
import {
  REVIEW_PASSES,
  REVIEW_STATUSES,
  type ReviewPass,
  type ReviewStatus,
} from "@/lib/closing/review";
import type { VoucherFlag } from "@/lib/closing/flags";
import { useFormat } from "@/lib/ui/use-format";
import { EvidenceTag } from "../../evidence-cell";
import { ReviewTag } from "../../review-tag";

// Written out rather than built from the flag, so that every key is one the
// messages test can find (src/i18n/messages.test.ts).
const FLAG_HINT: Record<VoucherFlag, string> = {
  outsideYear: "outsideYearHint",
  possibleDuplicate: "possibleDuplicateHint",
  deadlineWaived: "deadlineWaivedHint",
  ownBooking: "ownBookingHint",
};

export default function ClosingVoucherClient({
  year,
  voucher,
  ownPass,
}: {
  year: ClosingYear;
  voucher: ClosingVoucherDetail;
  /** The pass this viewer reviews in, or null when they review in neither. */
  ownPass: ReviewPass | null;
}) {
  const t = useTranslations("closing.voucher");
  const tReview = useTranslations("closing.review");
  const tEvidence = useTranslations("closing.evidence");
  const tFlag = useTranslations("closing.flag");
  const { date, dateTime } = useFormat();
  const controls = useTableControls();
  const { pending, mutate } = useMutation();
  const [draft, setDraft] = useState("");
  const e = voucher.evidence;
  const api = `/api/closing/${year.id}/vouchers/${voucher.key}`;

  async function review(status: ReviewStatus) {
    const body: ReviewVoucherBody = { status, contentHash: voucher.contentHash };
    await mutate(`${api}/review`, { key: `review-${status}`, body, error: t("reviewFailed") });
  }

  async function comment() {
    const body: VoucherCommentBody = { body: draft, contentHash: voucher.contentHash };
    const res = await mutate(`${api}/comments`, { key: "comment", body, error: t("commentFailed") });
    if (res) setDraft("");
  }

  const money = (v: number) => (v ? <Amount value={v} /> : null);
  const columns: Column<ClosingVoucherRow>[] = [
    {
      key: "account",
      header: t("row.account"),
      mobile: "title",
      cell: (r) => (
        <span className="break-words">
          {r.account} - {r.accountName}
        </span>
      ),
    },
    {
      key: "costCenter",
      header: t("row.costCenter"),
      mobile: "meta",
      cell: (r) => r.costCenter,
    },
    { key: "project", header: t("row.project"), mobile: "meta", cell: (r) => r.project },
    {
      key: "text",
      header: t("row.text"),
      mobile: "meta",
      cell: (r) => <span className="break-words">{r.text}</span>,
    },
    {
      key: "debit",
      header: t("row.debit"),
      align: "right",
      mobile: "trailing",
      className: "whitespace-nowrap",
      cell: (r) => money(r.debit),
    },
    {
      key: "credit",
      header: t("row.credit"),
      align: "right",
      mobile: "trailing",
      className: "whitespace-nowrap",
      cell: (r) => money(r.credit),
    },
  ];

  return (
    <PageShell
      title={voucher.key}
      subtitle={`${date(voucher.date)} - ${voucher.description}`}
      back="/closing/vouchers"
      width="content"
    >
      <div className="flex flex-col gap-6">
        {voucher.flags.length > 0 && (
          <Notice tone="warning">
            {voucher.flags.map((f) => (
              <p key={f}>{tFlag(FLAG_HINT[f])}</p>
            ))}
          </Notice>
        )}

        <Card>
          <CardHeader title={tReview("title")} />
          <CardBody className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              {REVIEW_PASSES.map((p) => {
                const s = voucher.review[p];
                const record =
                  s.state === "reviewed" ? s.review : s.state === "changed" ? s.previous : null;
                return (
                  <div key={p} className="flex flex-col gap-1">
                    <dt className="text-xs font-medium text-muted">{tReview(`pass.${p}`)}</dt>
                    <dd className="flex flex-wrap items-center gap-2 text-sm">
                      <ReviewTag state={s} />
                      {record && (
                        <span className="text-muted">
                          {tReview("by", {
                            name: record.reviewedBy ?? tReview("someone"),
                            when: dateTime(record.reviewedAt),
                          })}
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>

            {ownPass && (
              <div className="flex flex-wrap gap-2">
                {REVIEW_STATUSES.map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={status === "OK" ? "primary" : "secondary"}
                    loading={pending === `review-${status}`}
                    disabled={pending !== null}
                    onClick={() => review(status)}
                  >
                    {tReview(`action.${status}`)}
                  </Button>
                ))}
              </div>
            )}

            {voucher.history.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">
                  {tReview("history", { count: voucher.history.length })}
                </summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {voucher.history.map((r) => (
                    <li key={`${r.pass}-${r.reviewedAt}`} className="flex flex-wrap gap-2">
                      <span className="text-muted">{dateTime(r.reviewedAt)}</span>
                      <span>{tReview(`pass.${r.pass}`)}</span>
                      <span className="font-medium">{tReview(`status.${r.status}`)}</span>
                      <span className="text-muted">{r.reviewedBy ?? tReview("someone")}</span>
                      {r.contentHash !== voucher.contentHash && (
                        <Tag tone="purple" size="sm">
                          {tReview("earlierVersion")}
                        </Tag>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("evidenceTitle")} action={<EvidenceTag evidence={e} />} />
          <CardBody className="flex flex-col gap-4">
            {e.kind === "none" && <p className="text-sm text-muted">{t("noneBody")}</p>}
            {e.kind !== "none" && !e.agrees && (
              <Notice tone="danger">{tEvidence("disagreesHint")}</Notice>
            )}
            {e.kind === "expense" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  <span className="font-medium">{e.title}</span>
                  <span className="text-muted"> {t("receipts", { count: e.receipts })}</span>
                </p>
                <ButtonLink href={`/expenses/${e.id}`} size="sm" variant="secondary">
                  {t("openExpense")}
                </ButtonLink>
              </div>
            )}
            {e.kind === "income" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">{t("incomeDay", { date: date(e.date) })}</p>
                <ButtonLink
                  href={`/api/income/reports/${e.id}/document`}
                  size="sm"
                  variant="secondary"
                >
                  {t("openIncome")}
                </ButtonLink>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("rows")} action={<Amount value={voucher.amount} size="md" />} />
          <ClientDataTable
            columns={columns}
            rows={voucher.rows}
            controls={controls}
            rowKey={(r) => r.id}
            empty={t("noRows")}
          />
        </Card>

        <Card>
          <CardHeader title={t("thread")} />
          <CardBody className="flex flex-col gap-4">
            {voucher.thread.length === 0 && (
              <p className="text-sm text-muted">{t("threadEmpty")}</p>
            )}
            {voucher.thread.map((c) => (
              <div key={c.id} className="flex flex-col gap-1 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-foreground">
                    {c.author ?? tReview("someone")}
                  </span>
                  <span>{dateTime(c.createdAt)}</span>
                  {c.earlierVersion && (
                    <Tag tone="purple" size="sm">
                      {tReview("earlierVersion")}
                    </Tag>
                  )}
                </p>
                <p className="whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            ))}
            <form
              className="flex flex-col gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (draft.trim()) void comment();
              }}
            >
              <Textarea
                aria-label={t("commentLabel")}
                placeholder={t("commentPlaceholder")}
                value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
              />
              <div>
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  loading={pending === "comment"}
                  disabled={!draft.trim()}
                >
                  {t("commentSend")}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </PageShell>
  );
}
