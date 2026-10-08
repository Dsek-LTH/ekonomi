"use client";

// Settings → Fortnox. Everything touching the integration lives here: the
// connection itself, where exports land, and what is mirrored from Fortnox
// (the chart of accounts and the ledger). Cost centres
// sync from Fortnox too, but they are managed on their own settings page since
// local ones are added and edited there as well. Bookkeeping and Utfall only
// show read-only status and link here.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { EmptyNote } from "@/components/ui/empty-state";
import { FieldGroup, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconChevronDown, IconSync } from "@/components/ui/icons";
import { SearchInput } from "@/components/ui/search-input";
import { Tag } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/confirm-dialog";
import { FortnoxBanner } from "@/components/shell/fortnox-banner";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";

import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { sentence } from "@/lib/ui/format";
import type { AccountSyncResult, CostCenterSyncResult } from "@/lib/fortnox/sync";
import type {
  AccountRecord,
  BookkeepingSettings,
  FortnoxStatus,
} from "@/lib/domain/types";

interface LedgerYear {
  id: number;
  year: number;
  lastSyncAt: string | null;
}


export function FortnoxClient({
  fortnox,
  accounts,
  settings,
  ledgerYears,
  costCenters,
}: {
  fortnox: FortnoxStatus;
  accounts: AccountRecord[];
  settings: BookkeepingSettings;
  ledgerYears: LedgerYear[];
  /** The Fortnox-owned cost centres: how many, and when the sync last ran. */
  costCenters: { count: number; lastSyncAt: string | null };
}) {
  const t = useTranslations("admin.fortnox");
  const tCostCenters = useTranslations("admin.costCenters");
  const tBookkeeping = useTranslations("bookkeeping");
  const tBook = useTranslations("book");
  const tLedger = useTranslations("ledger");
  const { dateTime } = useFormat();
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();

  const [accountQuery, setAccountQuery] = useState("");
  const [series, setSeries] = useState(fortnox.voucherSeries ?? "A");
  const [showAccounts, setShowAccounts] = useState(false);

  const connected = fortnox.connected;
  const savedSeries = fortnox.voucherSeries ?? "A";
  const accountOptions: ComboOption[] = accounts
    .filter((a) => a.active)
    .map((a) => ({ value: a.number, label: `${a.number} – ${a.name}` }));

  const q = accountQuery.trim().toLowerCase();
  const visibleAccounts = q
    ? accounts.filter(
        (a) => a.number.includes(q) || a.name.toLowerCase().includes(q),
      )
    : accounts;

  const lastAccountSync = accounts.reduce<string | null>(
    (latest, a) => (a.lastSyncAt && (!latest || a.lastSyncAt > latest) ? a.lastSyncAt : latest),
    null,
  );

  async function disconnect() {
    const ok = await confirm({
      title: t("disconnectTitle"),
      message: t("disconnectMessage"),
      confirmLabel: t("disconnect"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate("/api/fortnox", {
      key: "disconnect",
      method: "DELETE",
      success: t("disconnected"),
      error: t("disconnectFailed"),
    });
  }

  async function syncAccounts() {
    const data = await mutate<AccountSyncResult>("/api/fortnox/accounts/sync", {
      key: "accounts",
      error: t("chartSyncFailed"),
    });
    if (!data) return;
    notify.success(
      sentence(
        t("chartSummary.fetched", { count: data.upserted }),
        data.deactivated && t("chartSummary.retired", { count: data.deactivated }),
      ),
      t("chartSynced"),
    );
  }

  // Cost centres are listed and added to on their own settings page (local
  // ones live there too), but fetched here, with everything else that comes
  // from Fortnox.
  async function syncCostCenters() {
    const data = await mutate<CostCenterSyncResult>("/api/cost-centers/sync", {
      key: "costCenters",
      error: tCostCenters("syncFailed"),
    });
    if (!data) return;
    const { upserted, deactivated, deleted, madeLocal } = data;
    notify.success(
      sentence(
        tCostCenters("syncSummary.updated", { count: upserted }),
        deactivated && tCostCenters("syncSummary.retired", { count: deactivated }),
        deleted && tCostCenters("syncSummary.deleted", { count: deleted }),
        madeLocal && tCostCenters("syncSummary.madeLocal", { count: madeLocal }),
      ),
      tCostCenters("syncDone"),
    );
  }

  // One financial year per click. "current" is the year we're in, also the only
  // thing to press before any year has been fetched, since the per-year buttons
  // below are built from the years a sync has already found. A full backfill is
  // a long job and stays with the CLI (pnpm fortnox:sync --all) rather than a
  // button someone has to sit and wait on.
  async function syncLedger(target: number | "current") {
    const data = await mutate<{ totalVouchers: number }>("/api/fortnox/sync", {
      key: `ledger-${target}`,
      // Fortnox's financial-year id, which is what FortnoxFinancialYear.id
      // holds and what syncLedger filters on.
      body: target === "current" ? { scope: "current" } : { financialYearId: target },
      error: tCostCenters("syncFailed"),
    });
    if (!data) return;
    notify.success(t("ledgerSummary", { count: data.totalVouchers }), t("ledgerSynced"));
  }

  async function saveSetting(body: Record<string, string>, success: string) {
    await mutate("/api/fortnox/settings", {
      key: Object.keys(body)[0],
      method: "PATCH",
      body,
      success,
      error: t("saveFailed"),
    });
  }

  // One row of the sync card: what it is, when it was last fetched, and the
  // button that fetches it again. The chart and every ledger year are the same
  // kind of thing, so they read as one list rather than two cards.
  function syncButton(key: string, label: string, onClick: () => void) {
    return (
      <IconButton
        label={pending === key ? tCostCenters("syncing") : label}
        title={connected ? undefined : tBookkeeping("connectFirst")}
        disabled={!connected || pending === key}
        onClick={onClick}
      >
        <IconSync className={cn("size-4", pending === key && "animate-spin")} />
      </IconButton>
    );
  }

  return (
    <div className="space-y-5">
      {/* Three cards, each answering one question: is it connected, where
          does an export land, and is what we mirror from Fortnox current. The
          settings used to be split between the first card and the middle of
          the chart of accounts, under its search box, so the page did not say
          at a glance what could be set on it. */}
      <Card>
        <CardHeader
          title={t("connection")}
          subtitle={t("connectionSubtitle")}
          action={
            connected ? (
              <Button
                variant="secondary"
                size="sm"
                loading={pending === "disconnect"}
                onClick={disconnect}
              >
                {t("disconnect")}
              </Button>
            ) : fortnox.configured ? (
              <ButtonLink
                href={`/api/fortnox/connect?mode=service&returnTo=${encodeURIComponent("/admin/fortnox")}`}
                size="sm"
              >
                {t("connect")}
              </ButtonLink>
            ) : undefined
          }
        />
        <CardBody>
          <FortnoxBanner
            ok={connected}
            title={
              !fortnox.configured
                ? t("notConfigured")
                : connected
                  ? t("connected", {
                      company: fortnox.companyName ? ` – ${fortnox.companyName}` : "",
                    })
                  : t("notConnected")
            }
            detail={
              !fortnox.configured
                ? t("unconfigured")
                : connected
                  ? fortnox.expiresAt
                    ? t("tokenValidUntil", { time: dateTime(fortnox.expiresAt) })
                    : undefined
                  : t("connectHint")
            }
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("booking")} subtitle={t("bookingSubtitle")} />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)]">
            <FieldGroup label={t("voucherSeries")} hint={t("voucherSeriesHint")}>
              <div className="flex gap-2">
                <Input
                  value={series}
                  onChange={(e) => setSeries(e.target.value.toUpperCase().slice(0, 4))}
                  disabled={!connected}
                  aria-label={t("voucherSeries")}
                  className="min-w-0 uppercase"
                />
                {/* Always there rather than appearing on the first keystroke:
                    a button that materialises shifts the row beside it. */}
                <Button
                  variant="secondary"
                  disabled={!connected || series === savedSeries}
                  loading={pending === "voucherSeries"}
                  onClick={() => saveSetting({ voucherSeries: series }, t("voucherSeriesSaved"))}
                >
                  {tCostCenters("save")}
                </Button>
              </div>
            </FieldGroup>
            <FieldGroup label={t("bankAccount")} hint={t("bankAccountHint")}>
              <Combobox
                options={accountOptions}
                value={settings.bankAccount}
                onChange={(v) => saveSetting({ bankAccount: v }, t("bankAccountSaved"))}
                placeholder={tBook("accountPlaceholder")}
                searchPlaceholder={tBook("accountSearch")}
                aria-label={t("bankAccount")}
              />
            </FieldGroup>
            <FieldGroup label={t("debtAccount")} hint={t("debtAccountHint")}>
              <Combobox
                options={accountOptions}
                value={settings.memberDebtAccount}
                onChange={(v) => saveSetting({ memberDebtAccount: v }, t("debtAccountSaved"))}
                placeholder={tBook("accountPlaceholder")}
                searchPlaceholder={tBook("accountSearch")}
                aria-label={t("debtAccount")}
              />
            </FieldGroup>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("sync")} subtitle={t("syncSubtitle")} />
        {/* Said once, rather than under each greyed-out button, and in words
            rather than a tooltip nobody hovers on a phone. */}
        {!connected && (
          <p className="border-b border-border px-inset py-3 text-sm text-muted">
            {tBookkeeping("connectFirst")}
          </p>
        )}

        {/* Two groups, because they are two kinds of thing. The registers are
            lists the app books against, fetched whole. The ledger is what was
            booked, fetched a financial year at a time. As one list of five
            rows the difference was in the labels alone, and "Huvudbok 2025"
            next to "Kontoplan" did not say why one had a year and the other
            did not. Each group says what its rows are for. */}
        <SyncGroup title={t("groupRegisters")} hint={t("groupRegistersHint")}>
          <SyncRow
            label={t("chart")}
            meta={
              lastAccountSync
                ? t("chartSubtitle", { count: accounts.length, time: dateTime(lastAccountSync) })
                : t("chartSubtitleNever", { count: accounts.length })
            }
          >
            {accounts.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showAccounts}
                onClick={() => setShowAccounts(!showAccounts)}
              >
                {showAccounts ? t("hideAccounts") : t("showAccounts")}
                <IconChevronDown
                  className={cn("size-4 transition-transform", showAccounts && "rotate-180")}
                />
              </Button>
            )}
            {syncButton("accounts", t("syncChart"), syncAccounts)}
          </SyncRow>

          {/* The accounts themselves, for looking one up. Hundreds of rows, so
              folded away until asked for: it was most of the page, and none
              of it is a setting. */}
          {showAccounts && (
            <li className="border-b border-border bg-surface">
              <div className="px-inset py-3 sm:w-80">
                <SearchInput
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  placeholder={tBook("accountSearch")}
                />
              </div>
              {visibleAccounts.length === 0 ? (
                <EmptyNote className="pt-0">{t("chartNoMatch")}</EmptyNote>
              ) : (
                <ul className="max-h-80 overflow-y-auto border-t border-border">
                  {visibleAccounts.map((a) => (
                    <li
                      key={a.number}
                      className={cn(
                        "flex items-center gap-4 border-b border-border px-inset py-2 last:border-0",
                        !a.active && "opacity-55",
                      )}
                    >
                      <span className="w-14 shrink-0 font-mono text-sm font-semibold tabular-nums">
                        {a.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                      {a.number === settings.bankAccount && <Tag>{t("bankAccount")}</Tag>}
                      {a.number === settings.memberDebtAccount && <Tag>{t("debtAccount")}</Tag>}
                      {!a.active && <span className="text-xs text-muted">{tCostCenters("inactive")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}

          <SyncRow
            label={t("costCenters")}
            meta={
              costCenters.lastSyncAt
                ? t("costCentersSubtitle", {
                    count: costCenters.count,
                    time: dateTime(costCenters.lastSyncAt),
                  })
                : t("costCentersSubtitleNever")
            }
          >
            {syncButton("costCenters", tCostCenters("sync"), syncCostCenters)}
          </SyncRow>
        </SyncGroup>

        <SyncGroup title={t("ledger")} hint={t("groupLedgerHint")}>
          {ledgerYears.length === 0 ? (
            // Nothing fetched yet, so there are no years to list a button
            // against. The current year is the one to start from.
            <SyncRow label={t("noYears")}>
              {syncButton("ledger-current", t("syncCurrentYear"), () => syncLedger("current"))}
            </SyncRow>
          ) : (
            ledgerYears.map((y) => (
              // The year as a plain string: it is a label, not a quantity,
              // and sv-SE would group it into "2 025".
              <SyncRow
                key={y.id}
                label={String(y.year)}
                meta={
                  y.lastSyncAt
                    ? tLedger("lastSynced", { time: dateTime(y.lastSyncAt) })
                    : t("neverSynced")
                }
              >
                {syncButton(`ledger-${y.id}`, t("syncYear", { year: String(y.year) }), () =>
                  syncLedger(y.id),
                )}
              </SyncRow>
            ))
          )}
          {/* About the ledger alone, so it sits in its group rather than at
              the foot of the card. */}
          <li className="px-inset py-3 text-xs text-muted">
            {t.rich("openingBalancesNote", { code: (chunks) => <code>{chunks}</code> })}
          </li>
        </SyncGroup>
      </Card>
    </div>
  );
}

/** A heading over related sync rows, saying what they are for. */
function SyncGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border last:border-0">
      <div className="border-b border-border bg-surface px-inset py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <ul>{children}</ul>
    </section>
  );
}

/** What is fetched, when it last was, and the controls for it on the right. */
function SyncRow({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-inset py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {meta && <p className="text-xs text-muted">{meta}</p>}
      </div>
      {children}
    </li>
  );
}
