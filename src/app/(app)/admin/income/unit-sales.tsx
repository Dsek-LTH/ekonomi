"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useDraft, useDraftPart, useDraftRows } from "@/components/settings/settings-draft";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ExpandToggle } from "@/components/ui/expand-toggle";
import { FieldGroup, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import type { CostCenter, ResultUnit } from "@/lib/domain/types";

type Mutate = ReturnType<typeof useMutation>["mutate"];

const NO_PREFIXES: NonNullable<ResultUnit["income"]>["prefixes"] = [];

export function UnitSales({
  unit,
  costCenters,
  isFallback,
  pending,
  mutate,
}: {
  unit: ResultUnit;
  costCenters: CostCenter[];
  isFallback: boolean;
  pending: string | null;
  mutate: Mutate;
}) {
  const t = useTranslations("admin.resultUnits");
  const tIncome = useTranslations("admin.resultUnits.income");
  const tSales = useTranslations("admin.income.units");
  const tCostCenters = useTranslations("admin.costCenters");
  const confirm = useConfirm();

  const income = unit.income;
  const [open, setOpen] = useState(Boolean(income && income.prefixes.length === 0));
  const [productDraft, setProductDraft] = useState<{ code: string; account: string } | null>(null);

  const ownCodes = new Set(unit.costCenters.map((c) => c.code));
  const chosen = new Set([
    income?.defaultCostCenterId,
    ...(income?.prefixes.map((p) => p.costCenterId) ?? []),
  ]);
  const ccOptions = costCenters
    .filter((c) => ownCodes.has(c.code) || chosen.has(c.id))
    .map((c) => ({ value: c.id, label: `${c.code} - ${c.name}`, short: c.code }));

  async function enableIncome() {
    const ok = await mutate("/api/income/units", {
      key: `income-new-${unit.id}`,
      body: { resultUnitId: unit.id, description: unit.resultUnit },
      error: t("saveFailed"),
    });
    if (ok) setOpen(true);
  }

  // The text, the cost centre and each prefix's cost centre wait for the page's Spara. Turning sales on or off and
  // adding or removing a prefix happen at once.
  const draft = useDraft({
    description: income?.description ?? "",
    defaultCostCenterId: income?.defaultCostCenterId ?? "",
  });
  const prefixEdits = useDraftRows(income?.prefixes ?? NO_PREFIXES);

  useDraftPart({
    dirty: draft.dirty || prefixEdits.dirty,
    save: async () => {
      if (!income) return true;
      if (draft.dirty) {
        const { description, defaultCostCenterId } = draft.changes;
        const ok = await mutate(`/api/income/units/${income.id}`, {
          method: "PATCH",
          body: {
            ...(description !== undefined && { description }),
            ...(defaultCostCenterId !== undefined && {
              defaultCostCenterId: defaultCostCenterId || null,
            }),
          },
          error: t("saveFailed"),
          refresh: false,
        });
        if (ok === null) return false;
      }
      for (const [id, change] of prefixEdits.changes) {
        const ok = await mutate(`/api/income/prefixes/${id}`, {
          method: "PATCH",
          body: { costCenterId: change.costCenterId || null },
          error: t("saveFailed"),
          refresh: false,
        });
        if (ok === null) return false;
      }
      return true;
    },
    commit: () => {
      draft.commit();
      prefixEdits.commit();
    },
    reset: () => {
      draft.reset();
      prefixEdits.reset();
    },
  });

  async function removeIncome() {
    if (!income) return;
    const ok = await confirm({
      title: tIncome("removeTitle", { name: unit.resultUnit }),
      message: tIncome("removeBody"),
      confirmLabel: tIncome("remove"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/income/units/${income.id}`, {
      key: `income-${income.id}`,
      method: "DELETE",
      error: t("saveFailed"),
    });
  }

  async function addProductPrefix() {
    if (!income || !productDraft) return;
    const ok = await mutate("/api/income/prefixes", {
      key: `addProduct-${unit.id}`,
      body: {
        incomeId: income.id,
        code: productDraft.code.trim(),
        account: productDraft.account.trim(),
      },
      error: t("saveFailed"),
    });
    if (ok) setProductDraft(null);
  }

  async function removeProductPrefix(id: string) {
    await mutate(`/api/income/prefixes/${id}`, {
      key: `product-${id}`,
      method: "DELETE",
      error: t("saveFailed"),
    });
  }

  return (
    <li className="border-b border-border px-inset py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{unit.resultUnit}</p>
          <p className="truncate text-xs text-muted">
            {!income
              ? tSales("notSelling")
              : income.prefixes.length === 0
                ? tSales("noProducts")
                : income.prefixes.map((p) => p.code).join(", ")}
          </p>
        </div>
        {income && income.prefixes.length === 0 && (
          <Tag tone="warning">{tSales("needsProducts")}</Tag>
        )}
        {isFallback && (
          <span title={tIncome("fallbackHint")}>
            <Tag tone="accent">{tIncome("fallback")}</Tag>
          </span>
        )}
        {!income ? (
          <Button
            size="sm"
            variant="secondary"
            loading={pending === `income-new-${unit.id}`}
            onClick={enableIncome}
          >
            <IconPlus className="size-4" />
            {tIncome("enable")}
          </Button>
        ) : (
          <ExpandToggle open={open} onToggle={() => setOpen(!open)}>
            {tSales("edit")}
          </ExpandToggle>
        )}
      </div>

      {income && open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldGroup label={tIncome("description")} hint={tIncome("descriptionHint")}>
              <Input
                size="sm"
                value={draft.value.description}
                aria-label={tIncome("description")}
                onChange={(e) => draft.set("description", e.target.value)}
              />
            </FieldGroup>
            <FieldGroup
              label={tIncome("defaultCostCenter")}
              hint={tIncome("defaultCostCenterHint")}
            >
              <Combobox
                size="sm"
                options={ccOptions}
                value={draft.value.defaultCostCenterId}
                onChange={(v) => draft.set("defaultCostCenterId", v)}
                placeholder={tIncome("noCostCenter")}
                emptyText={tIncome("noOwnCostCenters")}
                allowClear
                aria-label={tIncome("defaultCostCenter")}
              />
            </FieldGroup>
          </div>

          <FieldGroup label={tIncome("productPrefixes")} hint={tIncome("productHint")}>
            <ul className="rounded-control border border-border">
              {income.prefixes.map(prefixEdits.get).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-0"
                >
                  <span className="w-20 shrink-0 font-mono text-sm font-semibold">{p.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-mono tabular-nums">{p.account}</span>
                    {p.accountName && <span className="text-muted"> - {p.accountName}</span>}
                  </span>
                  {/* An account the chart has never heard of is a voucher Fortnox will reject, but only at export, so it is worth saying here. */}
                  {!p.accountName && <Tag tone="warning">{tIncome("unknownAccount")}</Tag>}
                  <span className="w-36 shrink-0">
                    <Combobox
                      size="sm"
                      options={ccOptions}
                      value={p.costCenterId ?? ""}
                      onChange={(v) => prefixEdits.set(p.id, { costCenterId: v || null })}
                      allowClear
                      placeholder={tIncome("prefixCostCenterDefault")}
                      aria-label={tIncome("prefixCostCenter", { code: p.code })}
                    />
                  </span>
                  <IconButton
                    tone="danger"
                    size="xs"
                    loading={pending === `product-${p.id}`}
                    label={tIncome("prefixRemove")}
                    onClick={() => removeProductPrefix(p.id)}
                  >
                    <IconTrash className="size-3.5" />
                  </IconButton>
                </li>
              ))}
              <li className="flex flex-wrap items-center gap-2 bg-surface px-3 py-2">
                <span className="w-20 shrink-0">
                  <Input
                    size="sm"
                    value={productDraft?.code ?? ""}
                    onChange={(e) =>
                      setProductDraft({
                        account: productDraft?.account ?? "",
                        code: e.target.value,
                      })
                    }
                    placeholder="c"
                    aria-label={tIncome("prefixCode")}
                    className="font-mono"
                  />
                </span>
                <span className="w-24">
                  <Input
                    size="sm"
                    inputMode="numeric"
                    value={productDraft?.account ?? ""}
                    onChange={(e) =>
                      setProductDraft({
                        code: productDraft?.code ?? "",
                        account: e.target.value,
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addProductPrefix();
                    }}
                    placeholder="3011"
                    aria-label={tIncome("prefixAccount")}
                    className="font-mono"
                  />
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending === `addProduct-${unit.id}`}
                  disabled={!productDraft?.code.trim() || !productDraft.account.trim()}
                  onClick={addProductPrefix}
                >
                  <IconPlus className="size-4" />
                  {tCostCenters("add")}
                </Button>
              </li>
            </ul>
          </FieldGroup>

          <div className="flex justify-end">
            <Button
              variant="dangerOutline"
              size="sm"
              loading={pending === `income-${income.id}`}
              onClick={removeIncome}
            >
              {tIncome("remove")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
