"use client";

// One result unit's sales, as a row of Inställningar → Försäljning.
//
// It used to be the third section of the unit's dialog under Resultatenheter,
// which meant setting up income took a dialog per unit on one page and the
// accounts on another, and nothing said what was still missing. Now every unit
// is a row here: whether it sells, and how, beside the accounts its takings are
// booked against.
//
// Everything a unit needs in order to take money in. The key its reports are
// grouped by is not among these: it is derived from the name when the profile
// is created and never changed, and nobody here needs to read it.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ExpandToggle } from "@/components/ui/expand-toggle";
import { FieldGroup, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import type { CostCenter, ResultUnit } from "@/lib/domain/types";

type Mutate = ReturnType<typeof useMutation>["mutate"];

export function UnitSales({
  unit,
  costCenters,
  isFallback,
  pending,
  mutate,
}: {
  unit: ResultUnit;
  costCenters: CostCenter[];
  /** Where sales matching no prefix go. Set once for the whole page. */
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
  // Open from the start when the unit sells and has nothing to sell yet: that
  // is the one state on this page that is waiting for somebody.
  const [open, setOpen] = useState(Boolean(income && income.prefixes.length === 0));
  const [productDraft, setProductDraft] = useState<{ code: string; account: string } | null>(null);

  // Only the unit's own cost centres: its sales are attested by its own
  // resultatansvariga, which another unit's cost centre would hand to someone
  // else. The one already chosen stays offered if it no longer matches (a
  // prefix removed since), so the picker shows it rather than going blank.
  const ownCodes = new Set(unit.costCenters.map((c) => c.code));
  const ccOptions = costCenters
    .filter((c) => ownCodes.has(c.code) || c.id === income?.defaultCostCenterId)
    .map((c) => ({ value: c.id, label: `${c.code} - ${c.name}`, short: c.code }));

  async function enableIncome() {
    const ok = await mutate("/api/income/units", {
      key: `income-new-${unit.id}`,
      // The verifikationstext starts as the unit's own name. It is what the
      // voucher will say, and that is a better start than blank.
      body: { resultUnitId: unit.id, description: unit.resultUnit },
      error: t("saveFailed"),
    });
    // Straight on to its products: a unit that sells nothing yet is not done.
    if (ok) setOpen(true);
  }

  async function updateIncome(body: Record<string, unknown>) {
    if (!income) return;
    await mutate(`/api/income/units/${income.id}`, {
      key: `income-${income.id}`,
      method: "PATCH",
      body,
      error: t("saveFailed"),
    });
  }

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
        {income && income.prefixes.length === 0 && <Tag tone="warning">{tSales("needsProducts")}</Tag>}
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
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label={tIncome("description")} hint={tIncome("descriptionHint")}>
              <Input
                size="sm"
                // Uncontrolled: it commits on blur rather than on every
                // keystroke.
                defaultValue={income.description}
                aria-label={tIncome("description")}
                onBlur={(e) =>
                  e.target.value !== income.description && updateIncome({ description: e.target.value })
                }
              />
            </FieldGroup>
            <FieldGroup label={tIncome("defaultCostCenter")} hint={tIncome("defaultCostCenterHint")}>
              <Combobox
                size="sm"
                options={ccOptions}
                value={income.defaultCostCenterId ?? ""}
                onChange={(v) => updateIncome({ defaultCostCenterId: v || null })}
                placeholder={tIncome("noCostCenter")}
                emptyText={tIncome("noOwnCostCenters")}
                allowClear
                aria-label={tIncome("defaultCostCenter")}
              />
            </FieldGroup>
          </div>

          {/* Which goods are this unit's: a small table of "starts with" and
              the account it is booked to, the add row as its last line. */}
          <FieldGroup label={tIncome("productPrefixes")} hint={tIncome("productHint")}>
            <ul className="rounded-control border border-border">
              {income.prefixes.map((p) => (
                <li key={p.id} className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-0">
                  <span className="w-20 shrink-0 font-mono text-sm font-semibold">{p.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-mono tabular-nums">{p.account}</span>
                    {p.accountName && <span className="text-muted"> - {p.accountName}</span>}
                  </span>
                  {/* An account the chart has never heard of is a voucher
                      Fortnox will reject, but only at export, so it is worth
                      saying here. */}
                  {!p.accountName && <Tag tone="warning">{tIncome("unknownAccount")}</Tag>}
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
                    onChange={(e) => setProductDraft({ account: productDraft?.account ?? "", code: e.target.value })}
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
                    onChange={(e) => setProductDraft({ code: productDraft?.code ?? "", account: e.target.value })}
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
