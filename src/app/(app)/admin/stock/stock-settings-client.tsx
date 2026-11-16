"use client";

// How each stock is booked. Everything saves as it is picked, like the income settings, and nothing is exported
// for a stock until what its own vouchers need has been chosen (lib/stock/setup.ts).
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateInput, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconCheck, IconPlus, IconTrash } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import type { PatchStockGroup, UpdateStock } from "@/lib/api/schemas/stock";
import type {
  StockGroupSettings,
  StockPlaceSettings,
  StockSettingsView,
} from "@/lib/data/stock-settings";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";
import type { StockSetupGap } from "@/lib/stock/setup";
import { STOCKS } from "@/lib/stock/stocks";
import { cn } from "@/lib/ui/utils";
import { PlaceTable } from "./place-table";

type Shared = {
  accountOptions: ComboOption[];
  costCenterOptions: ComboOption[];
  defaultSeries: string | null;
  knownGroups: string[];
};

export function StockSettingsClient({
  stocks,
  accounts,
  costCenters,
  defaultSeries,
  places,
  knownGroups,
}: {
  stocks: StockSettingsView[];
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  defaultSeries: string | null;
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
    defaultSeries,
    knownGroups,
  };
  return (
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
  );
}

function StockSection({
  settings,
  places,
  accountOptions,
  costCenterOptions,
  defaultSeries,
  knownGroups,
}: { settings: StockSettingsView; places: StockPlaceSettings[] } & Shared) {
  const t = useTranslations("admin.stock");
  const tBook = useTranslations("book");
  const { pending, mutate } = useMutation();
  const stock = settings.stock;
  const traits = STOCKS[stock];

  // Shown from local state so a pick reads at once; the refresh after the save brings the server's view back.
  const [s, setS] = useState(settings);
  const [series, setSeries] = useState(settings.voucherSeries ?? "");
  const [days, setDays] = useState(
    settings.expiryLeadDays === null ? "" : String(settings.expiryLeadDays),
  );
  const [startsOn, setStartsOn] = useState(settings.postingStartsOn ?? "");

  async function save(patch: UpdateStock, key: string) {
    setS((now) => ({ ...now, ...patch }));
    await mutate(`/api/stock/stocks/${stock}`, {
      key: `${stock}.${key}`,
      method: "PATCH",
      body: patch,
      error: t("saveFailed"),
      success: t("saved"),
    });
  }

  const account = (key: "purchaseOffsetAccount" | "boardCostAccount" | "boardSalesAccount") => (
    <Combobox
      size="sm"
      options={accountOptions}
      value={s[key] ?? ""}
      onChange={(v) => save({ [key]: v || null }, key)}
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
      value={s[key] ?? ""}
      onChange={(v) => save({ [key]: v || null }, key)}
      placeholder={t("chooseCostCenter")}
      allowClear
      aria-label={t(`field.${key}`)}
    />
  );

  const parsedDays = Number(days.trim());
  const daysValid =
    days.trim() === "" || (Number.isInteger(parsedDays) && parsedDays >= 0 && parsedDays <= 365);
  const daysValue = days.trim() === "" ? null : parsedDays;

  return (
    <section id={stock} className="scroll-mt-4 space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t(`stock.${stock}`)}</h2>
        <Status gaps={settings.gaps} />
      </div>

      {settings.gaps.length > 0 && (
        <Notice tone="info">
          <p>{t("gaps.intro")}</p>
          <ul className="mt-1 list-disc pl-5">
            {settings.gaps.map((gap) => (
              <li key={`${gap.key}:${gap.group ?? ""}`}>
                {gap.group
                  ? t(`gaps.${gap.key}`, { group: gap.group })
                  : t(`gaps.${gap.key}`, { group: "" })}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <Card>
        <CardHeader title={t("groups.title")} subtitle={t("groups.hint")} />
        <GroupTable stock={stock} groups={settings.groups} accountOptions={accountOptions} />
      </Card>

      {traits.usesPlaces && (
        <Card>
          <CardHeader title={t("places.title")} subtitle={t("places.hint")} />
          <PlaceTable
            stock={stock}
            places={places}
            knownGroups={knownGroups}
            costCenterOptions={costCenterOptions}
          />
        </Card>
      )}

      <Card>
        <CardHeader title={t("booking.title")} subtitle={t(`booking.hint.${s.purchaseMode}`)} />
        <ul>
          <Row label={t("field.consumptionCostCenterId")} hint={t("hint.consumptionCostCenterId")}>
            {costCenter("consumptionCostCenterId")}
          </Row>
          {s.purchaseMode === "EXPENSED" && (
            <>
              <Row label={t("field.purchaseOffsetAccount")} hint={t("hint.purchaseOffsetAccount")}>
                {account("purchaseOffsetAccount")}
              </Row>
              <Row label={t("field.purchaseCostCenterId")} hint={t("hint.purchaseCostCenterId")}>
                {costCenter("purchaseCostCenterId")}
              </Row>
            </>
          )}
          <Row label={t("field.lossCostCenterId")} hint={t("hint.lossCostCenterId")}>
            {costCenter("lossCostCenterId")}
          </Row>
          <Row label={t("field.countDiffCostCenterId")} hint={t("hint.countDiffCostCenterId")}>
            {costCenter("countDiffCostCenterId")}
          </Row>
          {traits.allowsBoardWithdrawals && (
            <>
              <Row label={t("field.boardCostAccount")} hint={t("hint.boardCostAccount")}>
                {account("boardCostAccount")}
              </Row>
              <Row label={t("field.boardCostCenterId")} hint={t("hint.boardCostCenterId")}>
                {costCenter("boardCostCenterId")}
              </Row>
              <Row label={t("field.boardSalesAccount")} hint={t("hint.boardSalesAccount")}>
                {account("boardSalesAccount")}
              </Row>
              <Row
                label={t("field.boardSalesCostCenterId")}
                hint={t("hint.boardSalesCostCenterId")}
              >
                {costCenter("boardSalesCostCenterId")}
              </Row>
            </>
          )}
          <Row
            label={t("field.voucherSeries")}
            hint={
              defaultSeries
                ? t("hint.voucherSeries", { series: defaultSeries })
                : t("hint.voucherSeriesUnconnected")
            }
          >
            <div className="flex gap-2">
              <Input
                size="sm"
                className="min-w-0 font-mono uppercase"
                value={series}
                onChange={(e) => setSeries(e.target.value.toUpperCase())}
                placeholder={defaultSeries ?? ""}
                maxLength={4}
                aria-label={t("field.voucherSeries")}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={series === (settings.voucherSeries ?? "")}
                loading={pending === `${stock}.voucherSeries`}
                onClick={() => save({ voucherSeries: series || null }, "voucherSeries")}
              >
                {t("save")}
              </Button>
            </div>
          </Row>
          <Row label={t("field.postingStartsOn")} hint={t("hint.postingStartsOn")}>
            <div className="flex gap-2">
              <DateInput
                size="sm"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                aria-label={t("field.postingStartsOn")}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={startsOn === (settings.postingStartsOn ?? "")}
                loading={pending === `${stock}.postingStartsOn`}
                onClick={() => save({ postingStartsOn: startsOn || null }, "postingStartsOn")}
              >
                {t("save")}
              </Button>
            </div>
          </Row>
        </ul>
      </Card>

      <Card>
        <CardHeader title={t("expiry.title")} subtitle={t("expiry.hint")} />
        <ul>
          <Row label={t("expiry.leadDays")} hint={t("expiry.leadDaysHint")}>
            <div className="flex gap-2">
              <Input
                size="sm"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                inputMode="numeric"
                className="min-w-0 tabular-nums"
                aria-label={t("expiry.leadDays")}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={!daysValid || daysValue === settings.expiryLeadDays}
                loading={pending === `${stock}.expiryLeadDays`}
                onClick={() => save({ expiryLeadDays: daysValue }, "expiryLeadDays")}
              >
                {t("save")}
              </Button>
            </div>
          </Row>
        </ul>
      </Card>
    </section>
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
  const [rows, setRows] = useState(groups);
  const [name, setName] = useState("");

  // The list follows the server after a save (a new or removed type), adjusted during render.
  const [seen, setSeen] = useState(groups);
  if (seen !== groups) {
    setSeen(groups);
    setRows(groups);
  }

  async function patch(group: StockGroupSettings, body: PatchStockGroup, key: string) {
    setRows((now) => now.map((g) => (g.id === group.id ? { ...g, ...body } : g)));
    await mutate(`/api/stock/groups/${group.id}`, {
      key: `${group.id}.${key}`,
      method: "PATCH",
      body,
      error: t("saveFailed"),
      success: t("saved"),
    });
  }

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
              {GROUP_ACCOUNTS.map((key: GroupAccount) => (
                <label key={key} className="block min-w-0">
                  <span className="mb-1 block text-xs text-muted">{t(`groups.${key}`)}</span>
                  <Combobox
                    size="sm"
                    options={accountOptions}
                    value={group[key] ?? ""}
                    onChange={(v) => patch(group, { [key]: v || null }, key)}
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
                </label>
              ))}
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

function Status({ gaps }: { gaps: StockSetupGap[] }) {
  const t = useTranslations("admin.stock");
  const left = gaps.length;
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs font-medium",
        left ? "text-warning" : "text-success",
      )}
    >
      {left === 0 && <IconCheck className="size-3.5" />}
      {left ? t("gaps.left", { count: left }) : t("gaps.none")}
    </span>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <li className="grid gap-2 border-t border-border px-inset py-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}
