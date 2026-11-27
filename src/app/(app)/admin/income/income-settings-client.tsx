"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useMutation } from "@/components/shell/use-mutation";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { SettingRow, SettingsCard, SetupStatus } from "@/components/settings/settings-card";
import {
  SettingsForm,
  SettingsLink,
  useDraft,
  useDraftPart,
} from "@/components/settings/settings-draft";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import type { IncomeConfigView } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter, ResultUnit } from "@/lib/domain/types";
import type { IncomeSetupSection, IncomeSetupStep } from "@/lib/income/setup";

import { UnitSales } from "./unit-sales";
import { parseSEK, sekToOre } from "@/lib/domain/money";

type AccountKey =
  "zettleClearingAccount" | "swishClearingAccount" | "zettleFeeAccount" | "incomeFallbackAccount";

type IncomeSettingsProps = {
  config: IncomeConfigView;
  resultUnits: ResultUnit[];
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  setup: IncomeSetupStep[];
  serviceConfigured: boolean;
};

export function IncomeSettingsClient(props: IncomeSettingsProps) {
  return (
    <SettingsForm>
      <IncomeSettings {...props} />
    </SettingsForm>
  );
}

function IncomeSettings({
  config,
  resultUnits,
  costCenters,
  accounts,
  setup,
  serviceConfigured,
}: IncomeSettingsProps) {
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

  const settings = config.settings;
  const [newFallback, setNewFallback] = useState({ amount: "", message: "" });

  // The accounts, the series and the fallback wait for the page's Spara (docs/settings.md).
  const draft = useDraft({
    zettleClearingAccount: settings.zettleClearingAccount ?? "",
    swishClearingAccount: settings.swishClearingAccount ?? "",
    zettleFeeAccount: settings.zettleFeeAccount ?? "",
    zettleFeeCostCenterId: settings.zettleFeeCostCenterId ?? "",
    incomeVoucherSeries: settings.incomeVoucherSeries ?? "",
    incomeFallbackIncomeId: settings.incomeFallbackIncomeId ?? "",
    incomeFallbackAccount: settings.incomeFallbackAccount ?? "",
  });
  const d = draft.value;
  const needed = (value: string) => (value ? null : t("needed"));

  useDraftPart({
    dirty: draft.dirty,
    save: async () =>
      (await mutate("/api/income/settings", {
        method: "PATCH",
        body: draft.changes,
        error: t("saveFailed"),
        refresh: false,
      })) !== null,
    commit: draft.commit,
    reset: draft.reset,
  });

  const sellingOptions: ComboOption[] = resultUnits
    .filter((u) => u.income?.active)
    .map((u) => ({ value: u.income!.id, label: u.resultUnit }));

  async function addFallback() {
    // parseSEK, as every amount field: the field holds "1 000,00" (sekToInput).
    const kronor = parseSEK(newFallback.amount);
    if (kronor <= 0) return;
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
        value={d[key]}
        onChange={(v) => v && draft.set(key, v)}
        placeholder={tBook("accountPlaceholder")}
        searchPlaceholder={tBook("accountSearch")}
        aria-label={label}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Section id="service">
        <SettingsCard title={t("service.title")} action={<SectionStatus left={left("service")} />}>
          <p className="px-inset py-3 text-sm">
            {serviceConfigured ? t("service.connected") : t("service.missing")}
          </p>
        </SettingsCard>
      </Section>

      <Section id="units">
        <SettingsCard title={t("units.title")} action={<SectionStatus left={left("units")} />}>
          {resultUnits.length === 0 ? (
            <p className="px-inset py-3 text-sm text-muted">
              {t("units.empty")}{" "}
              <SettingsLink href="/admin/result-units" className="font-medium underline">
                {t("units.manageUnits")}
              </SettingsLink>
            </p>
          ) : (
            <>
              <ul className="border-b border-border">
                <SettingRow label={t("fallback.unit")} hint={t("fallback.unitHint")}>
                  <Combobox
                    size="sm"
                    options={sellingOptions}
                    value={d.incomeFallbackIncomeId}
                    onChange={(v) => draft.set("incomeFallbackIncomeId", v)}
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
              <ul>
                {resultUnits.map((u) => (
                  <UnitSales
                    key={u.id}
                    unit={u}
                    costCenters={costCenters}
                    isFallback={Boolean(u.income) && u.income?.id === d.incomeFallbackIncomeId}
                    pending={pending}
                    mutate={mutate}
                  />
                ))}
              </ul>
            </>
          )}
        </SettingsCard>
      </Section>

      <Section id="booking">
        <SettingsCard title={t("booking.title")} action={<SectionStatus left={left("booking")} />}>
          <ul>
            <SettingRow
              label={t("accounts.zettleClearing")}
              hint={t("accounts.clearingHint")}
              required
              missing={needed(d.zettleClearingAccount)}
            >
              {accountPicker("zettleClearingAccount", t("accounts.zettleClearing"))}
            </SettingRow>
            <SettingRow
              label={t("accounts.swishClearing")}
              hint={t("accounts.clearingHint")}
              required
              missing={needed(d.swishClearingAccount)}
            >
              {accountPicker("swishClearingAccount", t("accounts.swishClearing"))}
            </SettingRow>
            <SettingRow
              label={t("accounts.feeAccount")}
              hint={t("accounts.feeHint")}
              required
              missing={needed(d.zettleFeeAccount)}
            >
              {accountPicker("zettleFeeAccount", t("accounts.feeAccount"))}
            </SettingRow>
            <SettingRow label={t("accounts.feeCostCenter")} hint={t("accounts.feeCostCenterHint")}>
              <Combobox
                size="sm"
                options={ccOptions}
                value={d.zettleFeeCostCenterId}
                onChange={(v) => draft.set("zettleFeeCostCenterId", v)}
                placeholder={t("accounts.chooseCostCenter")}
                allowClear
                aria-label={t("accounts.feeCostCenter")}
              />
            </SettingRow>
            <SettingRow
              label={t("export.series")}
              hint={t("export.seriesHint")}
              required
              missing={needed(d.incomeVoucherSeries)}
            >
              <Input
                size="sm"
                className="min-w-0 font-mono uppercase"
                value={d.incomeVoucherSeries}
                onChange={(e) => draft.set("incomeVoucherSeries", e.target.value.toUpperCase())}
                maxLength={4}
                aria-label={t("export.series")}
              />
            </SettingRow>
          </ul>
        </SettingsCard>
      </Section>

      <SettingsCard
        title={t("fallbacks.title")}
        action={<span className="text-xs text-muted">{t("optional")}</span>}
      >
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
                width="full"
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
      </SettingsCard>
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
  return <SetupStatus left={left} label={left ? t("stepsLeft", { count: left }) : t("done")} />;
}
