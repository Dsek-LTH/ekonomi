"use client";

// Settings → Fortnox. Everything touching the integration lives here: the
// connection itself, the chart of accounts, and the ledger mirror. Cost centres
// sync from Fortnox too, but they are managed on their own settings page since
// local ones are added and edited there as well. Bookkeeping and Utfall only
// show read-only status and link here.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { EmptyNote } from "@/components/ui/empty-state";
import { Field, FieldGroup, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconSync } from "@/components/ui/icons";
import { SearchInput } from "@/components/ui/search-input";
import { Tag } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/confirm-dialog";
import { FortnoxBanner } from "@/components/shell/fortnox-banner";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";

import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
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
}: {
  fortnox: FortnoxStatus;
  accounts: AccountRecord[];
  settings: BookkeepingSettings;
  ledgerYears: LedgerYear[];
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

  const connected = fortnox.connected;
  const savedSeries = fortnox.voucherSeries ?? "A";
  const accountOptions: ComboOption[] = accounts
    .filter((a) => a.active)
    .map((a) => ({ value: a.number, label: `${a.number} · ${a.name}` }));

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
    const data = await mutate("/api/fortnox/accounts/sync", {
      key: "accounts",
      error: t("chartSyncFailed"),
    });
    if (!data) return;
    notify.success(
      data.deactivated
        ? t("chartSummaryWithRetired", {
            fetched: Number(data.upserted),
            retired: Number(data.deactivated),
          })
        : t("chartSummary", { fetched: Number(data.upserted) }),
      t("chartSynced"),
    );
  }

  // One financial year per click. "current" is the year we're in — also the only
  // thing to press before any year has been fetched, since the per-year buttons
  // below are built from the years a sync has already found. A full backfill is
  // a long job and stays with the CLI (pnpm fortnox:sync --all) rather than a
  // button someone has to sit and wait on.
  async function syncLedger(target: number | "current") {
    const data = await mutate("/api/fortnox/sync", {
      key: `ledger-${target}`,
      body: target === "current" ? { scope: "current" } : { year: target },
      error: tCostCenters("syncFailed"),
    });
    if (!data) return;
    notify.success(t("ledgerSummary", { count: Number(data.totalVouchers) }), t("ledgerSynced"));
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

  return (
    <div className="space-y-5">
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
            ) : undefined
          }
        />
        <CardBody className="space-y-4">
          <FortnoxBanner
            ok={connected}
            title={
              !fortnox.configured
                ? t("notConfigured")
                : connected
                  ? t("connected", {
                      company: fortnox.companyName ? ` — ${fortnox.companyName}` : "",
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

          {fortnox.configured &&
            (connected ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-24">
                  <Field label={t("voucherSeries")}>
                    <Input
                      size="sm"
                      value={series}
                      onChange={(e) => setSeries(e.target.value.toUpperCase().slice(0, 4))}
                      className="uppercase"
                    />
                  </Field>
                </div>
                {/* Always rendered rather than appearing on the first keystroke:
                    a button that materialises mid-row shifts the hint beside it. */}
                <Button
                  size="sm"
                  disabled={series === savedSeries}
                  loading={pending === "voucherSeries"}
                  onClick={() => saveSetting({ voucherSeries: series }, t("voucherSeriesSaved"))}
                >
                  {tCostCenters("save")}
                </Button>
                <p className="text-sm text-muted">{t("voucherSeriesHint")}</p>
              </div>
            ) : (
              <div className="flex justify-end">
                <ButtonLink
                  href={`/api/fortnox/connect?mode=service&returnTo=${encodeURIComponent("/admin/fortnox")}`}
                  size="sm"
                >
                  {t("connect")}
                </ButtonLink>
              </div>
            ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("chart")}
          subtitle={
            lastAccountSync
              ? t("chartSubtitle", {
                  count: accounts.length,
                  time: dateTime(lastAccountSync),
                })
              : t("chartSubtitleNever", { count: accounts.length })
          }
          action={
            <IconButton
              label={pending === "accounts" ? tCostCenters("syncing") : t("syncChart")}
              title={connected ? undefined : tBookkeeping("connectFirst")}
              disabled={!connected || pending === "accounts"}
              onClick={syncAccounts}
            >
              <IconSync className={cn("size-4", pending === "accounts" && "animate-spin")} />
            </IconButton>
          }
        />
        <CardBody className="space-y-4">
          {/* The sync button greys out without a connection; say why, rather
              than leaving it to a tooltip nobody hovers on a phone. */}
          {!connected && <p className="text-sm text-muted">{tBookkeeping("connectFirst")}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
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

          <div className="sm:w-64">
            <SearchInput
              value={accountQuery}
              onChange={(e) => setAccountQuery(e.target.value)}
              placeholder={tBook("accountSearch")}
            />
          </div>
        </CardBody>

        {accounts.length === 0 ? (
          <EmptyNote className="pt-0">{t("chartEmpty")}</EmptyNote>
        ) : visibleAccounts.length === 0 ? (
          <EmptyNote className="pt-0">{t("chartNoMatch")}</EmptyNote>
        ) : (
          <ul className="max-h-96 overflow-y-auto border-t border-border">
            {visibleAccounts.map((a) => (
              <li
                key={a.number}
                className={cn(
                  "flex items-center gap-4 border-b border-border px-inset py-2.5 last:border-0",
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
      </Card>

      <Card>
        <CardHeader
          title={t("ledger")}
          subtitle={t("ledgerSubtitle")}
          action={
            <IconButton
              label={pending === "ledger-current" ? tCostCenters("syncing") : t("syncCurrentYear")}
              title={connected ? undefined : tBookkeeping("connectFirst")}
              disabled={!connected || pending === "ledger-current"}
              onClick={() => syncLedger("current")}
            >
              <IconSync className={cn("size-4", pending === "ledger-current" && "animate-spin")} />
            </IconButton>
          }
        />
        {ledgerYears.length === 0 ? (
          <EmptyNote>{t("noYears")}</EmptyNote>
        ) : (
          <ul>
            {ledgerYears.map((y) => (
              <li
                key={y.id}
                className="flex items-center gap-4 border-b border-border px-inset py-3.5 last:border-0"
              >
                <Tag className="font-semibold">{y.year}</Tag>
                <span className="min-w-0 flex-1 text-sm text-muted">
                  {y.lastSyncAt
                    ? tLedger("lastSynced", { time: dateTime(y.lastSyncAt) })
                    : t("neverSynced")}
                </span>
                <IconButton
                  label={
                    pending === `ledger-${y.id}`
                      ? tCostCenters("syncing")
                      : // The year as a plain string: it is a label, not a
                        // quantity, and sv-SE would group it into "2 025".
                        t("syncYear", { year: String(y.year) })
                  }
                  title={connected ? undefined : tBookkeeping("connectFirst")}
                  disabled={!connected || pending === `ledger-${y.id}`}
                  onClick={() => syncLedger(y.id)}
                >
                  <IconSync
                    className={cn("size-4", pending === `ledger-${y.id}` && "animate-spin")}
                  />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <CardBody className="space-y-2">
          {!connected && <p className="text-sm text-muted">{tBookkeeping("connectFirst")}</p>}
          <p className="text-sm text-muted">
            {t.rich("openingBalancesNote", { code: (chunks) => <code>{chunks}</code> })}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
