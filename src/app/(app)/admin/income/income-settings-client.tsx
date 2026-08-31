"use client";

// Settings → Income. This screen is intakt's config.yaml: the table that
// decides which verksamhet a sold product belongs to and which account its
// money is credited to. It used to be a file on the treasurer's laptop, which
// meant only whoever held it could change the routing, and that the app and
// the service could disagree about it.
//
// The verksamheter themselves are resultatenheter, listed here whether or not
// they take money in. There used to be a second list, IncomeCommittee, beside
// the one under Inställningar → Resultatenheter, with nothing checking that the
// two agreed; Sexmästeriet was two rows in two tables that happened to share a
// name. Adding a unit therefore happens over there, and giving one income
// settings happens here.
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useMutation } from "@/components/shell/use-mutation";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { EmptyNote } from "@/components/ui/empty-state";
import { Field, FieldGroup, Input } from "@/components/ui/field";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { InfoHint } from "@/components/ui/info-hint";
import type { IncomeConfigView } from "@/lib/data/income-config";
import type { CostCenter } from "@/lib/domain/types";

export function IncomeSettingsClient({
  config,
  costCenters,
}: {
  config: IncomeConfigView;
  costCenters: CostCenter[];
}) {
  const t = useTranslations("admin.income");
  const ccOptions = costCenters.map((c) => ({
    value: c.id,
    label: `${c.code} – ${c.name}`,
    short: c.code,
  }));
  const { pending, mutate } = useMutation();

  // The fallback is a property of the whole table, not of one verksamhet, so it
  // is worth stating once at the top rather than only as a flag on a row.
  const fallback = config.units
    .flatMap((u) => u.income?.prefixes ?? [])
    .find((p) => p.isFallback);

  const [settings, setSettings] = useState(config.settings);
  const [newFallback, setNewFallback] = useState({ amount: "", message: "" });

  async function saveSettings() {
    await mutate("/api/income/settings", {
      key: "settings",
      method: "PATCH",
      body: settings,
      error: t("saveFailed"),
      success: t("saved"),
    });
  }

  /**
   * The export series, saved on its own rather than with the accounts above.
   *
   * A partial PATCH, which is what the route takes: the two cards are two
   * decisions and a save button that quietly wrote both would be one of them
   * happening by accident.
   */
  async function saveSeries() {
    await mutate("/api/income/settings", {
      key: "series",
      method: "PATCH",
      // "" is how the body says "clear it". See UpdateIncomeSettings. Cleared,
      // takings go to whatever series everything else does.
      body: { incomeVoucherSeries: settings.incomeVoucherSeries ?? "" },
      error: t("saveFailed"),
      success: t("saved"),
    });
  }

  async function addFallback() {
    const kronor = Number(newFallback.amount.replace(",", "."));
    if (!Number.isFinite(kronor) || kronor <= 0) return;
    const ok = await mutate("/api/income/swish-fallbacks", {
      key: "addFallback",
      body: { amount: Math.round(kronor * 100), message: newFallback.message },
      error: t("saveFailed"),
    });
    if (ok) setNewFallback({ amount: "", message: "" });
  }

  async function removeFallback(amountSEK: number) {
    await mutate(`/api/income/swish-fallbacks/${Math.round(amountSEK * 100)}`, {
      key: `fallback-${amountSEK}`,
      method: "DELETE",
      error: t("saveFailed"),
    });
  }

  return (
    <div className="space-y-8">
      {/* ── Accounts ── */}
      <Card>
        <CardHeader title={t("accounts.title")} subtitle={t("accounts.description")} />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("accounts.zettleClearing")} hint={t("accounts.clearingHint")}>
              <Input
                value={settings.zettleClearingAccount}
                onChange={(e) => setSettings({ ...settings, zettleClearingAccount: e.target.value })}
                inputMode="numeric"
              />
            </Field>
            <Field label={t("accounts.swishClearing")} hint={t("accounts.clearingHint")}>
              <Input
                value={settings.swishClearingAccount}
                onChange={(e) => setSettings({ ...settings, swishClearingAccount: e.target.value })}
                inputMode="numeric"
              />
            </Field>
            <Field label={t("accounts.feeAccount")} hint={t("accounts.feeHint")}>
              <Input
                value={settings.zettleFeeAccount}
                onChange={(e) => setSettings({ ...settings, zettleFeeAccount: e.target.value })}
                inputMode="numeric"
              />
            </Field>
            <FieldGroup label={t("accounts.feeCostCenter")} hint={t("accounts.feeCostCenterHint")}>
              <Combobox
                options={ccOptions}
                value={settings.zettleFeeCostCenterId ?? ""}
                onChange={(v) => setSettings({ ...settings, zettleFeeCostCenterId: v || null })}
                placeholder={t("accounts.chooseCostCenter")}
                allowClear
                aria-label={t("accounts.feeCostCenter")}
              />
            </FieldGroup>
          </div>
          <Button onClick={saveSettings} loading={pending === "settings"}>
            {t("save")}
          </Button>
        </CardBody>
      </Card>

      {/* ── Export ── */}
      <Card>
        <CardHeader title={t("export.title")} subtitle={t("export.description")} />
        <CardBody className="space-y-4">
          {/* Left empty, takings go wherever everything else does, which is
              what they did before this setting existed, and what the hint says
              rather than leaving an empty box reading as "nowhere". */}
          <Field
            label={t("export.series")}
            hint={
              settings.connectionVoucherSeries
                ? t("export.seriesHint", { series: settings.connectionVoucherSeries })
                : t("export.seriesHintUnconnected")
            }
          >
            <Input
              className="w-24 font-mono uppercase"
              value={settings.incomeVoucherSeries ?? ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  incomeVoucherSeries: e.target.value.toUpperCase() || null,
                })
              }
              placeholder={settings.connectionVoucherSeries ?? ""}
              maxLength={4}
              aria-label={t("export.series")}
            />
          </Field>
          <Button onClick={saveSeries} loading={pending === "series"}>
            {t("save")}
          </Button>
        </CardBody>
      </Card>

      {/* Everything about a particular verksamhet (its produktprefix, its
          verifikationstext, its kostnadsställe) is edited where the verksamhet
          is: Inställningar → Resultatenheter. What is left here is what belongs
          to income as a whole and to no unit in particular. */}
      {!fallback && (
        <Notice>
          {t("committees.noFallback")} <Link href="/admin/result-units" className="underline">{t("committees.manageUnits")}</Link>
        </Notice>
      )}

      {/* ── Swish amount fallbacks ── */}
      <Card>
        <CardHeader
          title={t("fallbacks.title")}
          subtitle={t("fallbacks.description")}
          action={<InfoHint label={t("fallbacks.title")}>{t("fallbacks.hint")}</InfoHint>}
        />
        <CardBody className="space-y-4">
          {config.fallbacks.length === 0 ? (
            <EmptyNote>{t("fallbacks.empty")}</EmptyNote>
          ) : (
            <div className="flex flex-wrap gap-2">
              {config.fallbacks.map((f) => (
                <span
                  key={f.amount}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs"
                >
                  <span className="font-medium tabular-nums">{f.amount.toFixed(2)} kr</span>
                  <span className="text-muted">→ {f.message}</span>
                  <button
                    type="button"
                    onClick={() => removeFallback(f.amount)}
                    disabled={pending === `fallback-${f.amount}`}
                    aria-label={t("fallbacks.remove")}
                    className="text-muted transition-colors hover:text-danger"
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <AmountInput
              value={newFallback.amount}
              onChange={(amount) => setNewFallback({ ...newFallback, amount })}
              placeholder={t("fallbacks.amountPlaceholder")}
              size="sm"
              className="w-28"
              aria-label={t("fallbacks.amount")}
            />
            <Input
              value={newFallback.message}
              onChange={(e) => setNewFallback({ ...newFallback, message: e.target.value })}
              placeholder={t("fallbacks.messagePlaceholder")}
              size="sm"
              className="w-48"
              aria-label={t("fallbacks.message")}
            />
            <Button
              size="sm"
              onClick={addFallback}
              loading={pending === "addFallback"}
              disabled={!newFallback.amount.trim() || !newFallback.message.trim()}
            >
              <IconPlus className="size-4" />
              {t("fallbacks.add")}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
