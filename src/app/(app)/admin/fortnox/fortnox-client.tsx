"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { EmptyNote } from "@/components/ui/empty-state";
import { FieldGroup, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconSync } from "@/components/ui/icons";
import { SearchInput } from "@/components/ui/search-input";
import { Tag } from "@/components/ui/status-pill";
import { ExpandToggle } from "@/components/ui/expand-toggle";
import { useConfirm } from "@/components/confirm-dialog";
import { FortnoxBanner } from "@/components/shell/fortnox-banner";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";

import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { sentence } from "@/lib/ui/format";
import type {
  AccountSyncResult,
  CostCenterSyncResult,
  ProjectSyncResult,
  SupplierSyncResult,
  SyncAllResult,
} from "@/lib/fortnox/sync";
import type { FortnoxSyncStatus } from "@/lib/data/fortnox";
import type { AccountRecord, BookkeepingSettings, FortnoxStatus } from "@/lib/domain/types";

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
  projects,
  suppliers,
  lastSync,
}: {
  fortnox: FortnoxStatus;
  accounts: AccountRecord[];
  settings: BookkeepingSettings;
  ledgerYears: LedgerYear[];
  costCenters: { count: number; lastSyncAt: string | null };
  projects: { count: number; lastSyncAt: string | null };
  suppliers: { count: number; lastSyncAt: string | null };
  lastSync: FortnoxSyncStatus;
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
  const [series, setSeries] = useState(fortnox.voucherSeries ?? "");
  const [showAccounts, setShowAccounts] = useState(false);

  const connected = fortnox.connected;
  const savedSeries = fortnox.voucherSeries ?? "";
  const accountOptions: ComboOption[] = accounts
    .filter((a) => a.active)
    .map((a) => ({ value: a.number, label: `${a.number} - ${a.name}` }));

  const q = accountQuery.trim().toLowerCase();
  const visibleAccounts = q
    ? accounts.filter((a) => a.number.includes(q) || a.name.toLowerCase().includes(q))
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

  async function syncProjects() {
    const data = await mutate<ProjectSyncResult>("/api/fortnox/projects/sync", {
      key: "projects",
      error: t("projectsSyncFailed"),
    });
    if (!data) return;
    notify.success(
      sentence(
        t("projectsSummary.fetched", { count: data.upserted }),
        data.deactivated && t("projectsSummary.retired", { count: data.deactivated }),
      ),
      t("projectsSynced"),
    );
  }

  async function syncSuppliers() {
    const data = await mutate<SupplierSyncResult>("/api/fortnox/suppliers/sync", {
      key: "suppliers",
      error: t("suppliersSyncFailed"),
    });
    if (!data) return;
    notify.success(t("suppliersSummary", { count: data.suppliers }), t("suppliersSynced"));
  }

  async function syncEverything() {
    const data = await mutate<SyncAllResult>("/api/fortnox/sync-all", {
      key: "all",
      error: t("syncAllFailed"),
    });
    if (!data) return;
    const failed =
      [data.financialYears, data.costCenters, data.projects, data.accounts, data.suppliers].some(
        (s) => !s.ok,
      ) || data.ledger.some((s) => !s.ok);
    if (failed) notify.error(t("syncAllPartial"));
    else notify.success(t("syncAllDone"));
  }

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

  // A full backfill is a long job and stays with the CLI (pnpm fortnox:sync --all)
  // rather than a button someone has to sit and wait on.
  async function syncLedger(target: number | "current") {
    const data = await mutate<{ totalVouchers: number }>("/api/fortnox/sync", {
      key: `ledger-${target}`,
      // Fortnox's financial-year id, which is what FortnoxFinancialYear.id holds and
      // what syncLedger filters on.
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
      <Card>
        <CardHeader
          title={t("connection")}
          subtitle={t("connectionSubtitle")}
          action={
            connected && fortnox.refreshFailed ? (
              <ButtonLink
                href={`/api/fortnox/connect?mode=service&returnTo=${encodeURIComponent("/admin/fortnox")}`}
                size="sm"
              >
                {t("reconnect")}
              </ButtonLink>
            ) : connected ? (
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
            ok={connected && !fortnox.refreshFailed}
            title={
              !fortnox.configured
                ? t("notConfigured")
                : connected
                  ? t("connected", {
                      company: fortnox.companyName ? ` - ${fortnox.companyName}` : "",
                    })
                  : t("notConnected")
            }
            detail={
              !fortnox.configured ? t("unconfigured") : connected ? undefined : t("connectHint")
            }
          />
          {connected && fortnox.refreshFailed && (
            <p className="mt-3 text-sm text-danger">
              {t("refreshFailed", {
                time: dateTime(fortnox.refreshFailed.at),
                error: fortnox.refreshFailed.error,
              })}
            </p>
          )}
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
                <Button
                  variant="secondary"
                  disabled={!connected || series === savedSeries}
                  loading={pending === "voucherSeries"}
                  onClick={() => saveSetting({ voucherSeries: series }, t("voucherSeriesSaved"))}
                >
                  {t("save")}
                </Button>
              </div>
            </FieldGroup>
            <FieldGroup label={t("bankAccount")} hint={t("bankAccountHint")}>
              <Combobox
                options={accountOptions}
                value={settings.bankAccount ?? ""}
                onChange={(v) => saveSetting({ bankAccount: v }, t("bankAccountSaved"))}
                placeholder={tBook("accountPlaceholder")}
                searchPlaceholder={tBook("accountSearch")}
                aria-label={t("bankAccount")}
              />
            </FieldGroup>
            <FieldGroup label={t("debtAccount")} hint={t("debtAccountHint")}>
              <Combobox
                options={accountOptions}
                value={settings.memberDebtAccount ?? ""}
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
        <CardHeader
          title={t("sync")}
          subtitle={t("syncSubtitle")}
          action={
            <Button
              variant="secondary"
              size="sm"
              disabled={!connected || Boolean(lastSync.runningSince)}
              loading={pending === "all"}
              onClick={syncEverything}
            >
              {t("syncAll")}
            </Button>
          }
        />
        {!connected ? (
          <p className="border-b border-border px-inset py-3 text-sm text-muted">
            {tBookkeeping("connectFirst")}
          </p>
        ) : (
          <div className="space-y-1 border-b border-border px-inset py-3 text-sm">
            <p className="text-muted">
              {lastSync.runningSince
                ? t("nightlyRunning", { time: dateTime(lastSync.runningSince) })
                : lastSync.lastFinishedAt
                  ? t("nightlyLast", { time: dateTime(lastSync.lastFinishedAt) })
                  : t("nightly")}
            </p>
            {lastSync.lastError && lastSync.lastFinishedAt && !lastSync.runningSince && (
              <p className="text-danger">
                {t("nightlyFailed", {
                  time: dateTime(lastSync.lastFinishedAt),
                  error: lastSync.lastError,
                })}
              </p>
            )}
          </div>
        )}

        <SyncGroup title={t("groupRegisters")} hint={t("groupRegistersHint")}>
          <SyncRow
            label={t("chart")}
            meta={
              lastAccountSync
                ? t("chartSubtitle", {
                    count: accounts.length,
                    time: dateTime(lastAccountSync),
                  })
                : t("chartSubtitleNever", { count: accounts.length })
            }
          >
            {accounts.length > 0 && (
              <ExpandToggle open={showAccounts} onToggle={() => setShowAccounts(!showAccounts)}>
                {showAccounts ? t("hideAccounts") : t("showAccounts")}
              </ExpandToggle>
            )}
            {syncButton("accounts", t("syncChart"), syncAccounts)}
          </SyncRow>

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
                      {!a.active && (
                        <span className="text-xs text-muted">{tCostCenters("inactive")}</span>
                      )}
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

          <SyncRow
            label={t("projects")}
            meta={
              projects.lastSyncAt
                ? t("projectsSubtitle", {
                    count: projects.count,
                    time: dateTime(projects.lastSyncAt),
                  })
                : t("projectsSubtitleNever")
            }
          >
            {syncButton("projects", t("syncProjects"), syncProjects)}
          </SyncRow>

          <SyncRow
            label={t("suppliers")}
            meta={
              suppliers.lastSyncAt
                ? t("suppliersSubtitle", {
                    count: suppliers.count,
                    time: dateTime(suppliers.lastSyncAt),
                  })
                : t("suppliersSubtitleNever")
            }
          >
            {syncButton("suppliers", t("syncSuppliers"), syncSuppliers)}
          </SyncRow>
        </SyncGroup>

        <SyncGroup title={t("ledger")} hint={t("groupLedgerHint")}>
          {ledgerYears.length === 0 ? (
            <SyncRow label={t("noYears")}>
              {syncButton("ledger-current", t("syncCurrentYear"), () => syncLedger("current"))}
            </SyncRow>
          ) : (
            ledgerYears.map((y) => (
              // The year as a plain string: it is a label, not a quantity, and sv-SE
              // would group it into "2 025".
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
          <li className="px-inset py-3 text-xs text-muted">
            {t.rich("openingBalancesNote", { code: (chunks) => <code>{chunks}</code> })}
          </li>
        </SyncGroup>
      </Card>
    </div>
  );
}

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
