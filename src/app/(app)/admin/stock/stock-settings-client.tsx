"use client";

// How each stock is booked. Everything saves as it is picked, like the income settings, and nothing is exported
// for a stock until what its own vouchers need has been chosen (lib/stock/setup.ts).
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import {
  SettingsForm,
  useDraft,
  useDraftPart,
  useDraftRows,
} from "@/components/settings/settings-draft";
import { Button } from "@/components/ui/button";
import {
  SettingRow,
  SettingsCard,
  SettingsSection,
  SetupStatus,
} from "@/components/settings/settings-card";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateInput, Field, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import type { PatchStockGroup } from "@/lib/api/schemas/stock";
import type {
  StockGroupSettings,
  StockPlaceSettings,
  StockSettingsView,
} from "@/lib/data/stock-settings";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";
import { STOCKS } from "@/lib/stock/stocks";
import { PlaceTable } from "./place-table";

type Shared = {
  accountOptions: ComboOption[];
  costCenterOptions: ComboOption[];
  knownGroups: string[];
};

export function StockSettingsClient({
  stocks,
  accounts,
  costCenters,
  places,
  knownGroups,
}: {
  stocks: StockSettingsView[];
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  places: StockPlaceSettings[];
  knownGroups: string[];
}) {
  const shared: Shared = {
    accountOptions: accounts.map((a) => ({
      value: a.number,
      label: `${a.number} - ${a.name}`,
      short: a.number,
    })),
    costCenterOptions: costCenters.map((c) => ({
      value: c.id,
      label: `${c.code} - ${c.name}`,
      short: c.code,
    })),
    knownGroups,
  };
  return (
    <SettingsForm>
      <div className="space-y-10">
        {stocks.map((s) => (
          <StockSection
            key={s.stock}
            settings={s}
            places={places.filter((p) => p.stock === s.stock)}
            {...shared}
          />
        ))}
      </div>
    </SettingsForm>
  );
}

function StockSection({
  settings,
  places,
  accountOptions,
  costCenterOptions,
  knownGroups,
}: { settings: StockSettingsView; places: StockPlaceSettings[] } & Shared) {
  const t = useTranslations("admin.stock");
  const tBook = useTranslations("book");
  const { mutate } = useMutation();
  const notify = useNotify();
  const stock = settings.stock;
  const traits = STOCKS[stock];

  // Every value here waits for the page's Spara (docs/settings.md). Held as text, the way the fields hold it.
  const draft = useDraft({
    consumptionCostCenterId: settings.consumptionCostCenterId ?? "",
    purchaseOffsetAccount: settings.purchaseOffsetAccount ?? "",
    purchaseCostCenterId: settings.purchaseCostCenterId ?? "",
    lossCostCenterId: settings.lossCostCenterId ?? "",
    countDiffCostCenterId: settings.countDiffCostCenterId ?? "",
    boardCostAccount: settings.boardCostAccount ?? "",
    boardCostCenterId: settings.boardCostCenterId ?? "",
    boardSalesAccount: settings.boardSalesAccount ?? "",
    boardSalesCostCenterId: settings.boardSalesCostCenterId ?? "",
    voucherSeries: settings.voucherSeries ?? "",
    postingStartsOn: settings.postingStartsOn ?? "",
    expiryLeadDays: settings.expiryLeadDays === null ? "" : String(settings.expiryLeadDays),
  });
  const s = draft.value;

  const days = s.expiryLeadDays.trim();
  const parsedDays = Number(days);
  const daysValid =
    days === "" || (Number.isInteger(parsedDays) && parsedDays >= 0 && parsedDays <= 365);

  useDraftPart({
    dirty: draft.dirty,
    save: async () => {
      if (!daysValid) {
        notify.error(t("expiry.invalid"));
        return false;
      }
      const body: Record<string, string | number | null> = {};
      for (const [key, value] of Object.entries(draft.changes)) {
        const text = String(value ?? "").trim();
        body[key] = key === "expiryLeadDays" ? (text === "" ? null : Number(text)) : text || null;
      }
      return (
        (await mutate(`/api/stock/stocks/${stock}`, {
          method: "PATCH",
          body,
          error: t("saveFailed"),
          refresh: false,
        })) !== null
      );
    },
    commit: draft.commit,
    reset: draft.reset,
  });

  // What an empty required field holds up, under its name in place of the hint.
  const needed = (value: string) => (value ? null : t("needed"));

  const account = (key: "purchaseOffsetAccount" | "boardCostAccount" | "boardSalesAccount") => (
    <Combobox
      size="sm"
      options={accountOptions}
      value={s[key]}
      onChange={(v) => draft.set(key, v)}
      placeholder={tBook("accountPlaceholder")}
      searchPlaceholder={tBook("accountSearch")}
      allowClear
      aria-label={t(`field.${key}`)}
    />
  );
  const costCenter = (
    key:
      | "consumptionCostCenterId"
      | "purchaseCostCenterId"
      | "lossCostCenterId"
      | "countDiffCostCenterId"
      | "boardCostCenterId"
      | "boardSalesCostCenterId",
  ) => (
    <Combobox
      size="sm"
      options={costCenterOptions}
      value={s[key]}
      onChange={(v) => draft.set(key, v)}
      placeholder={t("chooseCostCenter")}
      allowClear
      aria-label={t(`field.${key}`)}
    />
  );

  return (
    <SettingsSection
      id={stock}
      title={t(`stock.${stock}`)}
      aside={
        <SetupStatus
          left={settings.gaps.length}
          label={
            settings.gaps.length ? t("gaps.left", { count: settings.gaps.length }) : t("gaps.none")
          }
        />
      }
    >
      <SettingsCard title={t("groups.title")}>
        <GroupTable stock={stock} groups={settings.groups} accountOptions={accountOptions} />
      </SettingsCard>

      {traits.usesPlaces && (
        <SettingsCard title={t("places.title")}>
          <PlaceTable
            stock={stock}
            places={places}
            knownGroups={knownGroups}
            costCenterOptions={costCenterOptions}
          />
        </SettingsCard>
      )}

      <SettingsCard title={t("booking.title")}>
        <ul>
          <SettingRow
            label={t("field.consumptionCostCenterId")}
            hint={t("hint.consumptionCostCenterId")}
          >
            {costCenter("consumptionCostCenterId")}
          </SettingRow>
          {settings.purchaseMode === "EXPENSED" && (
            <>
              <SettingRow
                label={t("field.purchaseOffsetAccount")}
                hint={t("hint.purchaseOffsetAccount")}
                required
                missing={needed(s.purchaseOffsetAccount)}
              >
                {account("purchaseOffsetAccount")}
              </SettingRow>
              <SettingRow
                label={t("field.purchaseCostCenterId")}
                hint={t("hint.purchaseCostCenterId")}
              >
                {costCenter("purchaseCostCenterId")}
              </SettingRow>
            </>
          )}
          <SettingRow label={t("field.lossCostCenterId")} hint={t("hint.lossCostCenterId")}>
            {costCenter("lossCostCenterId")}
          </SettingRow>
          <SettingRow
            label={t("field.countDiffCostCenterId")}
            hint={t("hint.countDiffCostCenterId")}
          >
            {costCenter("countDiffCostCenterId")}
          </SettingRow>
          {traits.allowsBoardWithdrawals && (
            <>
              <SettingRow
                label={t("field.boardCostAccount")}
                hint={t("hint.boardCostAccount")}
                required
                missing={needed(s.boardCostAccount)}
              >
                {account("boardCostAccount")}
              </SettingRow>
              <SettingRow label={t("field.boardCostCenterId")} hint={t("hint.boardCostCenterId")}>
                {costCenter("boardCostCenterId")}
              </SettingRow>
              <SettingRow label={t("field.boardSalesAccount")} hint={t("hint.boardSalesAccount")}>
                {account("boardSalesAccount")}
              </SettingRow>
              <SettingRow
                label={t("field.boardSalesCostCenterId")}
                hint={t("hint.boardSalesCostCenterId")}
              >
                {costCenter("boardSalesCostCenterId")}
              </SettingRow>
            </>
          )}
          <SettingRow
            label={t("field.voucherSeries")}
            hint={t("hint.voucherSeries")}
            required
            missing={needed(s.voucherSeries)}
          >
            <Input
              size="sm"
              className="min-w-0 font-mono uppercase"
              value={s.voucherSeries}
              onChange={(e) => draft.set("voucherSeries", e.target.value.toUpperCase())}
              maxLength={4}
              aria-label={t("field.voucherSeries")}
            />
          </SettingRow>
          <SettingRow
            label={t("field.postingStartsOn")}
            hint={t("hint.postingStartsOn")}
            required
            missing={needed(s.postingStartsOn)}
          >
            <DateInput
              size="sm"
              value={s.postingStartsOn}
              onChange={(e) => draft.set("postingStartsOn", e.target.value)}
              aria-label={t("field.postingStartsOn")}
            />
          </SettingRow>
        </ul>
      </SettingsCard>

      <SettingsCard title={t("expiry.title")}>
        <ul>
          <SettingRow label={t("expiry.leadDays")} hint={t("expiry.leadDaysHint")}>
            <Input
              size="sm"
              value={s.expiryLeadDays}
              onChange={(e) => draft.set("expiryLeadDays", e.target.value)}
              inputMode="numeric"
              className="min-w-0 tabular-nums"
              aria-label={t("expiry.leadDays")}
            />
          </SettingRow>
        </ul>
      </SettingsCard>
    </SettingsSection>
  );
}

const GROUP_ACCOUNTS = [
  "stockAccount",
  "consumptionAccount",
  "lossAccount",
  "countDiffAccount",
] as const;
type GroupAccount = (typeof GROUP_ACCOUNTS)[number];

/** The product types and the accounts each one's value and cost are booked on. */
function GroupTable({
  stock,
  groups,
  accountOptions,
}: {
  stock: StockSettingsView["stock"];
  groups: StockGroupSettings[];
  accountOptions: ComboOption[];
}) {
  const t = useTranslations("admin.stock");
  const tBook = useTranslations("book");
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const [name, setName] = useState("");

  // The accounts wait for the page's Spara. Adding and removing a type happen at once.
  const edits = useDraftRows(groups);
  const rows = groups.map(edits.get);

  useDraftPart({
    dirty: edits.dirty,
    save: async () => {
      for (const [id, change] of edits.changes) {
        const ok = await mutate(`/api/stock/groups/${id}`, {
          method: "PATCH",
          body: change satisfies PatchStockGroup,
          error: t("saveFailed"),
          refresh: false,
        });
        if (ok === null) return false;
      }
      return true;
    },
    commit: edits.commit,
    reset: edits.reset,
  });

  async function add() {
    const made = await mutate("/api/stock/groups", {
      key: `${stock}.addGroup`,
      body: { stock, name: name.trim() },
      error: t("saveFailed"),
    });
    if (made !== null) setName("");
  }

  async function remove(group: StockGroupSettings) {
    const ok = await confirm({
      title: t("groups.removeTitle", { name: group.name }),
      message: t("groups.removeMessage"),
      confirmLabel: t("groups.remove"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/stock/groups/${group.id}`, {
      key: `${group.id}.remove`,
      method: "DELETE",
      error: t("saveFailed"),
    });
  }

  return (
    <div className="border-t border-border">
      <ul>
        {rows.map((group) => (
          <li key={group.id} className="border-b border-border px-inset py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {group.name}{" "}
                <span className="font-normal text-muted">
                  {t("groups.products", { count: group.products })}
                </span>
              </p>
              {group.products === 0 && (
                <IconButton
                  label={t("groups.remove")}
                  title={t("groups.remove")}
                  loading={pending === `${group.id}.remove`}
                  onClick={() => remove(group)}
                >
                  <IconTrash className="size-4" />
                </IconButton>
              )}
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {GROUP_ACCOUNTS.map((key: GroupAccount) => {
                // A type with products in it needs its two accounts before a day can be posted (lib/stock/setup.ts).
                const required =
                  group.products > 0 && (key === "stockAccount" || key === "consumptionAccount");
                return (
                  <Field
                    key={key}
                    label={t(`groups.${key}`)}
                    requirement={required ? "required" : undefined}
                    error={required && !group[key] ? t("needed") : undefined}
                  >
                    <Combobox
                      size="sm"
                      options={accountOptions}
                      value={group[key] ?? ""}
                      onChange={(v) => edits.set(group.id, { [key]: v || null })}
                      // The two optional ones fall back to the cost account, and say so while empty.
                      placeholder={
                        key === "lossAccount" || key === "countDiffAccount"
                          ? t("groups.sameAsCost")
                          : tBook("accountPlaceholder")
                      }
                      searchPlaceholder={tBook("accountSearch")}
                      allowClear
                      aria-label={`${group.name}: ${t(`groups.${key}`)}`}
                    />
                  </Field>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 px-inset py-3">
        <Input
          size="sm"
          className="min-w-0 max-w-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("groups.newPlaceholder")}
          aria-label={t("groups.newPlaceholder")}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={name.trim() === ""}
          loading={pending === `${stock}.addGroup`}
          onClick={add}
        >
          <IconPlus className="size-4" />
          {t("groups.add")}
        </Button>
      </div>
    </div>
  );
}
