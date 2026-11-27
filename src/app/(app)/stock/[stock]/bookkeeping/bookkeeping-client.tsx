"use client";

// A stock's Bokföring page: the days not yet sent to Fortnox, the voucher through a date the bookkeeper picks,
// what has changed on days already sent, how the stock accounts compare with the ledger, and what has been sent.
// Nothing is sent unless somebody presses Bokför.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DateInput } from "@/components/ui/field";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Notice } from "@/components/ui/notice";
import type {
  PostingDay,
  PostingInFlight,
  PostingLineView,
  PostingPart,
  Reconciliation,
  SentVoucherDto,
  ThroughRefusal,
} from "@/lib/server/stock-posting";
import type { StockSetupGap } from "@/lib/stock/setup";
import { stockPath, type StockSlug } from "@/lib/stock/stocks";
import { formatOreKr } from "@/lib/ui/format";
import { cn } from "@/lib/ui/utils";

type Tab = "due" | "sent";

/** With its sign, to the öre: these are figures checked against a voucher. */
const signed = (ore: number) => `${ore > 0 ? "+" : ""}${formatOreKr(ore, { decimals: 2 })}`;

export default function BookkeepingClient({
  stock,
  days,
  voucher,
  voucherRefusal,
  through,
  sentThrough,
  corrections,
  inFlight,
  gaps,
  startsOn,
  sent,
  reconciliation,
  today,
  canExport,
  canUndo,
  canSetUp,
}: {
  stock: StockSlug;
  /** Days with something not yet sent, oldest first. */
  days: PostingDay[];
  /** The voucher through `through`: every day waiting up to it. Null when none can be made. */
  voucher: PostingDay | null;
  voucherRefusal: ThroughRefusal | null;
  /** The date the voucher runs through, empty when nothing is waiting. */
  through: string;
  /** How far the stock has been sent, or null before the first voucher. */
  sentThrough: string | null;
  corrections: PostingPart | null;
  inFlight: PostingInFlight[];
  gaps: StockSetupGap[];
  startsOn: string | null;
  sent: SentVoucherDto[];
  reconciliation: Reconciliation;
  today: string;
  canExport: boolean;
  canUndo: boolean;
  canSetUp: boolean;
}) {
  const t = useTranslations("stockVouchers");
  const confirm = useConfirm();
  const notify = useNotify();
  const { pending, mutate } = useMutation();
  const router = useRouter();
  const waiting = days.length + (corrections ? 1 : 0);
  const [tab, setTab] = useState<Tab>(waiting > 0 || sent.length === 0 ? "due" : "sent");
  const [reconDate, setReconDate] = useState(today);

  const blocked = gaps.length > 0 || inFlight.length > 0;
  const ready = canExport && !blocked;

  /** A new date draws its voucher on the server, so the preview is the figure that will be sent. */
  const pickThrough = (date: string) => {
    if (date) router.replace(`?through=${date}`, { scroll: false });
  };

  async function sendThrough(part: PostingDay) {
    const done = await mutate<{ label: string }>(
      `/api/stock-vouchers/${stock}/through/${part.date}/export`,
      { key: "through", body: { fingerprint: part.fingerprint }, error: t("sendFailed") },
    );
    if (!done) return;
    notify.success(t("sentOne", { label: done.label }));
    // The date asked for is spent. The next preview runs through whatever is still waiting.
    router.replace("?", { scroll: false });
  }

  async function sendCorrections(part: PostingPart) {
    const done = await mutate<{ label: string }>(
      `/api/stock-vouchers/${stock}/corrections/export`,
      {
        key: "corrections",
        body: { fingerprint: part.fingerprint },
        error: t("sendFailed"),
      },
    );
    if (done) notify.success(t("sentOne", { label: done.label }));
  }

  async function resolve(v: PostingInFlight) {
    const done = await mutate<{ released: boolean; label?: string }>(
      `/api/stock-vouchers/vouchers/${v.id}/resolve`,
      { key: `resolve:${v.id}`, error: t("resolveFailed") },
    );
    if (!done) return;
    notify.success(
      done.released ? t("resolvedReleased") : t("resolvedFound", { label: done.label ?? "" }),
    );
  }

  async function undo(v: SentVoucherDto) {
    const ok = await confirm({
      title: t("undoTitle", { label: v.label ?? v.description }),
      message: t("undoMessage"),
      confirmLabel: t("undo"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/stock-vouchers/vouchers/${v.id}/unexport`, {
      key: `undo:${v.id}`,
      error: t("undoFailed"),
      success: t("undone"),
    });
  }

  async function reconcile() {
    const ok = await confirm({
      title: t("recon.confirmTitle"),
      message: t("recon.confirmMessage", { date: reconDate }),
      confirmLabel: t("recon.action"),
    });
    if (!ok) return;
    const done = await mutate<{ label: string }>(`/api/stock-vouchers/${stock}/reconcile`, {
      key: "reconcile",
      body: { date: reconDate },
      error: t("sendFailed"),
    });
    if (done) notify.success(t("sentOne", { label: done.label }));
  }

  const differs = reconciliation.rows.some((r) => r.diffOre);

  return (
    <PageShell title={t("title")} width="content">
      <div className="space-y-5">
        {gaps.length > 0 && (
          <Notice tone="info">
            {startsOn ? t("notSetUp") : t("notStarted")}{" "}
            {canSetUp && (
              <Link href={`/admin/stock#${stock}`} className="font-medium underline">
                {t("setUp")}
              </Link>
            )}
          </Notice>
        )}

        {inFlight.map((v) => (
          <Notice key={v.id} tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t(v.state === "UNCERTAIN" ? "uncertain" : "inProgress", {
                  date: v.date,
                  name: v.by ?? "-",
                })}
              </span>
              {canExport && v.state !== "CLAIMED" && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending === `resolve:${v.id}`}
                  onClick={() => resolve(v)}
                >
                  {t("resolve")}
                </Button>
              )}
            </div>
          </Notice>
        ))}

        <Card>
          <CardHeader
            title={t("recon.title")}
            subtitle={
              reconciliation.ledgerSyncedAt
                ? t("recon.hint", { at: reconciliation.ledgerSyncedAt.slice(0, 10) })
                : t("recon.neverSynced")
            }
          />
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-xs text-muted">
                  <th className="px-inset py-2 font-medium">{t("recon.col.group")}</th>
                  <th className="px-3 py-2 font-medium">{t("recon.col.account")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("recon.col.app")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("recon.col.due")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("recon.col.fortnox")}</th>
                  <th className="px-inset py-2 text-right font-medium">{t("recon.col.diff")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 tabular-nums">
                {reconciliation.rows.map((r) => (
                  <tr key={r.groupId}>
                    <td className="px-inset py-2">{r.name}</td>
                    <td className="px-3 py-2 text-muted">{r.stockAccount ?? "-"}</td>
                    <td className="px-3 py-2 text-right">
                      {formatOreKr(r.appValueOre, { decimals: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right text-muted">
                      {r.dueOre === 0 ? "-" : signed(r.dueOre)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.fortnoxOre == null ? "-" : formatOreKr(r.fortnoxOre, { decimals: 2 })}
                    </td>
                    <td
                      className={cn(
                        "px-inset py-2 text-right font-medium",
                        r.diffOre ? "text-warning" : "text-muted",
                      )}
                    >
                      {r.diffOre == null
                        ? "-"
                        : r.diffOre === 0
                          ? t("recon.agrees")
                          : signed(r.diffOre)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reconciliation.stale && (
            <p className="px-inset pt-3 text-xs text-warning">{t("recon.stale")}</p>
          )}
          {canExport && differs && (
            <div className="flex flex-wrap items-center justify-end gap-2 px-inset py-3">
              <span className="text-xs text-muted">{t("recon.dateLabel")}</span>
              <DateInput
                size="sm"
                value={reconDate}
                max={today}
                onChange={(e) => setReconDate(e.target.value)}
                aria-label={t("recon.dateLabel")}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={reconciliation.stale || inFlight.length > 0 || !reconDate}
                loading={pending === "reconcile"}
                onClick={reconcile}
              >
                {t("recon.action")}
              </Button>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 px-inset pt-2">
            <FilterTabs<Tab>
              aria-label={t("tabsLabel")}
              value={tab}
              onChange={setTab}
              options={[
                { value: "due", label: t("tab.due"), badge: waiting || undefined, waiting: true },
                { value: "sent", label: t("tab.sent") },
              ]}
            />
            {sentThrough && (
              <span className="text-xs text-muted">{t("sentThrough", { date: sentThrough })}</span>
            )}
          </div>

          {tab === "due" ? (
            waiting === 0 ? (
              <p className="px-inset py-8 text-center text-sm text-muted">
                {startsOn ? t("nothingDue") : t("notStarted")}
              </p>
            ) : (
              <div className="border-t border-border">
                {days.length > 0 && (
                  <section className="space-y-3 px-inset py-4">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="block">
                        <span className="mb-1 block text-xs text-muted">{t("through.date")}</span>
                        <div className="w-40">
                          <DateInput
                            size="sm"
                            value={through}
                            min={days[0].date}
                            max={today}
                            onChange={(e) => pickThrough(e.target.value)}
                            aria-label={t("through.date")}
                          />
                        </div>
                      </label>
                      {voucher && (
                        <span className="pb-1.5 text-sm tabular-nums">
                          {signed(voucher.netOre)}
                        </span>
                      )}
                      {canExport && (
                        <Button
                          size="sm"
                          className="ml-auto"
                          disabled={!ready || !voucher?.lines}
                          loading={pending === "through"}
                          onClick={() => voucher && sendThrough(voucher)}
                        >
                          {t("through.send", { date: through })}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted">{t("through.hint")}</p>
                    {voucherRefusal ? (
                      <p className="text-sm text-warning">
                        {t(`through.refused.${voucherRefusal}`, {
                          date:
                            voucherRefusal === "alreadySent" ? (sentThrough ?? through) : through,
                        })}
                      </p>
                    ) : voucher?.lines ? (
                      <div className="rounded-control border border-border bg-surface/50 px-3 py-2">
                        <Lines lines={voucher.lines} />
                      </div>
                    ) : voucher ? (
                      <p className="text-sm text-warning">{t("missingAccount")}</p>
                    ) : null}
                  </section>
                )}
                <ul className="divide-y divide-border border-t border-border">
                  {days.map((day) => (
                    <DueRow
                      key={day.date}
                      title={day.date}
                      part={day}
                      // In the voucher being previewed, or left for a later one.
                      muted={!!through && day.date > through}
                      history={`${stockPath(stock, "/history")}?from=${day.date}&to=${day.date}`}
                      action={null}
                    />
                  ))}
                  {corrections && (
                    <DueRow
                      title={t("corrections")}
                      hint={t("correctionsHint")}
                      part={corrections}
                      action={
                        canExport ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!ready || !corrections.lines}
                            loading={pending === "corrections"}
                            onClick={() => sendCorrections(corrections)}
                          >
                            {t("send")}
                          </Button>
                        ) : null
                      }
                    />
                  )}
                </ul>
              </div>
            )
          ) : sent.length === 0 ? (
            <p className="px-inset py-8 text-center text-sm text-muted">{t("nothingSent")}</p>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface text-left text-xs text-muted">
                    <th className="px-inset py-2 font-medium">{t("col.date")}</th>
                    <th className="px-3 py-2 font-medium">{t("col.text")}</th>
                    <th className="px-3 py-2 font-medium">{t("col.voucher")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("col.change")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("col.valueAfter")}</th>
                    <th className="px-inset py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sent.map((v) => (
                    <tr key={v.id}>
                      <td className="px-inset py-2 tabular-nums">{v.date}</td>
                      <td className="px-3 py-2">{v.description}</td>
                      <td className="px-3 py-2 tabular-nums text-muted">{v.label ?? "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {v.kind === "RECONCILIATION" ? "-" : signed(v.netOre)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {formatOreKr(v.valueAfterOre, { decimals: 2 })}
                      </td>
                      <td className="px-inset py-2 text-right">
                        {canUndo && (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={pending === `undo:${v.id}`}
                            onClick={() => undo(v)}
                          >
                            {t("undo")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}

/** A day waiting, or the corrections: its net effect, and its voucher rows on their own. */
function DueRow({
  title,
  hint,
  part,
  muted = false,
  history,
  action,
}: {
  title: string;
  hint?: string;
  part: PostingPart;
  /** Left out of the voucher being previewed. */
  muted?: boolean;
  history?: string;
  action: React.ReactNode;
}) {
  const t = useTranslations("stockVouchers");
  const [open, setOpen] = useState(false);
  return (
    <li className={cn(muted && "text-muted")}>
      <div className="flex flex-wrap items-center gap-3 px-inset py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <span className="text-sm font-medium tabular-nums">{title}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </button>
        <span className="text-sm tabular-nums">{signed(part.netOre)}</span>
        {action}
      </div>
      {open && (
        <div className="border-t border-border/60 bg-surface/50 px-inset py-3">
          {part.lines ? (
            <Lines lines={part.lines} />
          ) : (
            <p className="text-sm text-warning">{t("missingAccount")}</p>
          )}
          {history && (
            <Link href={history} className="mt-2 inline-block text-xs link">
              {t("seeMovements")}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

function Lines({ lines }: { lines: PostingLineView[] }) {
  const t = useTranslations("stockVouchers");
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted">
          <th className="py-1 font-medium">{t("line.account")}</th>
          <th className="py-1 font-medium">{t("line.costCenter")}</th>
          <th className="py-1 font-medium">{t("line.text")}</th>
          <th className="py-1 text-right font-medium">{t("line.debit")}</th>
          <th className="py-1 text-right font-medium">{t("line.credit")}</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {lines.map((l, i) => (
          <tr key={i}>
            <td className="py-0.5">
              {l.account} - {l.accountName}
            </td>
            <td className="py-0.5 text-muted">{l.costCenterCode ?? ""}</td>
            <td className="py-0.5 text-muted">{l.description ?? ""}</td>
            <td className="py-0.5 text-right">
              {l.debit ? formatOreKr(l.debit, { decimals: 2 }) : ""}
            </td>
            <td className="py-0.5 text-right">
              {l.credit ? formatOreKr(l.credit, { decimals: 2 }) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
