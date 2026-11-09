"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useMutation } from "@/components/shell/use-mutation";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Card, CardHeader } from "@/components/ui/card";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconCheck, IconPlus, IconTrash } from "@/components/ui/icons";
import { InfoHint } from "@/components/ui/info-hint";
import type { IncomeConfigView } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter, ResultUnit } from "@/lib/domain/types";
import type { IncomeSetupSection, IncomeSetupStep } from "@/lib/income/setup";
import { cn } from "@/lib/ui/utils";

import { IncomeSetupNotice } from "../../income/setup-notice";
import { UnitSales } from "./unit-sales";
import { sekToOre } from "@/lib/domain/money";

type AccountKey =
  "zettleClearingAccount" | "swishClearingAccount" | "zettleFeeAccount" | "incomeFallbackAccount";

export function IncomeSettingsClient({
  config,
  resultUnits,
  costCenters,
  accounts,
  setup,
  serviceConfigured,
}: {
  config: IncomeConfigView;
  resultUnits: ResultUnit[];
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  setup: IncomeSetupStep[];
  serviceConfigured: boolean;
}) {
  const t = useTranslations("admin.income");
  const left = (section: IncomeSetupSection) => setup.filter((s) => s.section === section).length;
  const tBook = useTranslations("book");
  const { pending, mutate } = useMutation();

  const ccOptions = costCenters.map((c) => ({
    value: c.id,
    label: `${c.code} - ${c.name}`,
    short: c.code,
  }));
  const accountOptions: ComboOption[] = accounts.map((a) => ({
    value: a.number,
    label: `${a.number} - ${a.name}`,
    short: a.number,
  }));

  const [settings, setSettings] = useState(config.settings);
  const [series, setSeries] = useState(config.settings.incomeVoucherSeries ?? "");
  const savedSeries = config.settings.incomeVoucherSeries ?? "";
  const [newFallback, setNewFallback] = useState({ amount: "", message: "" });

  async function save(body: Record<string, string | null>, key: string) {
    await mutate("/api/income/settings", {
      key,
      method: "PATCH",
      body,
      error: t("saveFailed"),
      success: t("saved"),
    });
  }

  function pickAccount(key: AccountKey, value: string) {
    if (!value || value === settings[key]) return;
    setSettings({ ...settings, [key]: value });
    save({ [key]: value }, key);
  }

  function pickFallbackUnit(value: string) {
    setSettings({ ...settings, incomeFallbackIncomeId: value || null });
    save({ incomeFallbackIncomeId: value }, "incomeFallbackIncomeId");
  }

  const sellingOptions: ComboOption[] = resultUnits
    .filter((u) => u.income?.active)
    .map((u) => ({ value: u.income!.id, label: u.resultUnit }));

  function pickFeeCostCenter(value: string) {
    setSettings({ ...settings, zettleFeeCostCenterId: value || null });
    save({ zettleFeeCostCenterId: value }, "zettleFeeCostCenterId");
  }

  async function addFallback() {
    const kronor = Number(newFallback.amount.replace(",", "."));
    if (!Number.isFinite(kronor) || kronor <= 0) return;
    const ok = await mutate("/api/income/swish-fallbacks", {
      key: "addFallback",
      body: { amount: sekToOre(kronor), message: newFallback.message },
      error: t("saveFailed"),
    });
    if (ok) setNewFallback({ amount: "", message: "" });
  }

  async function removeFallback(amountSEK: number) {
    await mutate(`/api/income/swish-fallbacks/${sekToOre(amountSEK)}`, {
      key: `fallback-${amountSEK}`,
      method: "DELETE",
      error: t("saveFailed"),
    });
  }

  function accountPicker(key: AccountKey, label: string) {
    return (
      <Combobox
        size="sm"
        options={accountOptions}
        value={settings[key] ?? ""}
        onChange={(v) => pickAccount(key, v)}
        placeholder={tBook("accountPlaceholder")}
        searchPlaceholder={tBook("accountSearch")}
        aria-label={label}
      />
    );
  }

  return (
    <div className="space-y-5">
      {setup.length === 0 ? (
        <Notice tone="info">{t("ready")}</Notice>
      ) : (
        <IncomeSetupNotice steps={setup} canSetUp onPage />
      )}

      <Section id="service">
        <Card>
          <CardHeader
            title={t("service.title")}
            subtitle={t("service.description")}
            action={<SectionStatus left={left("service")} />}
          />
          <p className="px-inset pt-3 pb-4 text-sm">
            {serviceConfigured ? t("service.connected") : t("service.missing")}
          </p>
        </Card>
      </Section>

      <Section id="units">
        <Card>
          <CardHeader
            title={t("units.title")}
            subtitle={t("units.description")}
            action={<SectionStatus left={left("units")} />}
          />
          {resultUnits.length === 0 ? (
            <p className="px-inset pb-4 text-sm text-muted">
              {t("units.empty")}{" "}
              <Link href="/admin/result-units" className="font-medium underline">
                {t("units.manageUnits")}
              </Link>
            </p>
          ) : (
            <>
              <ul className="border-t border-border">
                <SettingRow label={t("fallback.unit")} hint={t("fallback.unitHint")}>
                  <Combobox
                    size="sm"
                    options={sellingOptions}
                    value={settings.incomeFallbackIncomeId ?? ""}
                    onChange={pickFallbackUnit}
                    placeholder={t("fallback.chooseUnit")}
                    emptyText={t("fallback.noSellingUnits")}
                    allowClear
                    aria-label={t("fallback.unit")}
                  />
                </SettingRow>
                <SettingRow label={t("fallback.account")} hint={t("fallback.accountHint")}>
                  {accountPicker("incomeFallbackAccount", t("fallback.account"))}
                </SettingRow>
              </ul>
              <ul className="border-t border-border">
                {resultUnits.map((u) => (
                  <UnitSales
                    key={u.id}
                    unit={u}
                    costCenters={costCenters}
                    isFallback={
                      Boolean(u.income) && u.income?.id === settings.incomeFallbackIncomeId
                    }
                    pending={pending}
                    mutate={mutate}
                  />
                ))}
              </ul>
            </>
          )}
        </Card>
      </Section>

      <Section id="booking">
        <Card>
          <CardHeader
            title={t("booking.title")}
            subtitle={t("booking.description")}
            action={<SectionStatus left={left("booking")} />}
          />
          <ul>
            <SettingRow label={t("accounts.zettleClearing")} hint={t("accounts.clearingHint")}>
              {accountPicker("zettleClearingAccount", t("accounts.zettleClearing"))}
            </SettingRow>
            <SettingRow label={t("accounts.swishClearing")} hint={t("accounts.clearingHint")}>
              {accountPicker("swishClearingAccount", t("accounts.swishClearing"))}
            </SettingRow>
            <SettingRow label={t("accounts.feeAccount")} hint={t("accounts.feeHint")}>
              {accountPicker("zettleFeeAccount", t("accounts.feeAccount"))}
            </SettingRow>
            <SettingRow label={t("accounts.feeCostCenter")} hint={t("accounts.feeCostCenterHint")}>
              <Combobox
                size="sm"
                options={ccOptions}
                value={settings.zettleFeeCostCenterId ?? ""}
                onChange={pickFeeCostCenter}
                placeholder={t("accounts.chooseCostCenter")}
                allowClear
                aria-label={t("accounts.feeCostCenter")}
              />
            </SettingRow>
            <SettingRow
              label={t("export.series")}
              hint={
                settings.connectionVoucherSeries
                  ? t("export.seriesHint", {
                      series: settings.connectionVoucherSeries,
                    })
                  : t("export.seriesHintUnconnected")
              }
            >
              <div className="flex gap-2">
                <Input
                  size="sm"
                  className="min-w-0 font-mono uppercase"
                  value={series}
                  onChange={(e) => setSeries(e.target.value.toUpperCase())}
                  placeholder={settings.connectionVoucherSeries ?? ""}
                  maxLength={4}
                  aria-label={t("export.series")}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={series === savedSeries}
                  loading={pending === "incomeVoucherSeries"}
                  onClick={() => save({ incomeVoucherSeries: series }, "incomeVoucherSeries")}
                >
                  {t("save")}
                </Button>
              </div>
            </SettingRow>
          </ul>
        </Card>
      </Section>

      <Card>
        <CardHeader
          title={t("fallbacks.title")}
          subtitle={t("fallbacks.description")}
          action={
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted">{t("optional")}</span>
              <InfoHint label={t("fallbacks.title")}>{t("fallbacks.hint")}</InfoHint>
            </span>
          }
        />
        <ul>
          {config.fallbacks.length === 0 && (
            <li className="border-b border-border px-inset py-3 text-sm text-muted">
              {t("fallbacks.empty")}
            </li>
          )}
          {config.fallbacks.map((f) => (
            <li
              key={f.amount}
              className="flex items-center gap-3 border-b border-border px-inset py-2"
            >
              <span className="w-28 shrink-0 text-right text-sm font-medium tabular-nums">
                {f.amount.toFixed(2)} kr
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{f.message}</span>
              <IconButton
                tone="danger"
                label={t("fallbacks.remove")}
                loading={pending === `fallback-${f.amount}`}
                onClick={() => removeFallback(f.amount)}
              >
                <IconTrash className="size-4" />
              </IconButton>
            </li>
          ))}
          <li className="flex flex-wrap items-center gap-3 px-inset py-3">
            <div className="w-28 shrink-0">
              <AmountInput
                value={newFallback.amount}
                onChange={(amount) => setNewFallback({ ...newFallback, amount })}
                placeholder={t("fallbacks.amountPlaceholder")}
                size="sm"
                aria-label={t("fallbacks.amount")}
              />
            </div>
            <div className="min-w-40 flex-1">
              <Input
                value={newFallback.message}
                onChange={(e) => setNewFallback({ ...newFallback, message: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFallback();
                }}
                placeholder={t("fallbacks.messagePlaceholder")}
                size="sm"
                aria-label={t("fallbacks.message")}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={addFallback}
              loading={pending === "addFallback"}
              disabled={!newFallback.amount.trim() || !newFallback.message.trim()}
            >
              <IconPlus className="size-4" />
              {t("fallbacks.add")}
            </Button>
          </li>
        </ul>
      </Card>
    </div>
  );
}

function Section({ id, children }: { id: IncomeSetupSection; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4">
      {children}
    </section>
  );
}

function SectionStatus({ left }: { left: number }) {
  const t = useTranslations("admin.income");
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs font-medium",
        left ? "text-warning" : "text-success",
      )}
    >
      {left === 0 && <IconCheck className="size-3.5" />}
      {left ? t("stepsLeft", { count: left }) : t("done")}
    </span>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <li className="grid gap-2 border-b border-border px-inset py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}
