// The bar above a cost-centre sheet: which cost centre this sheet is, and the
// three things you can do to the sheet as a whole — repoint it, duplicate it,
// drop it from the budget.
//
// A sheet need not be linked to a cost centre (see BudgetCostCenter in
// schema.prisma). While it isn't, its name is a free-text label you can edit in
// place, and the picker beside it is the thing that ends that state.
"use client";

import { useTranslations } from "next-intl";
import { Combobox } from "@/components/ui/combobox";
import { EditableText } from "@/components/ui/editable-text";
import { IconButton } from "@/components/ui/icon-button";
import { IconCopy, IconTrash } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { sheetName } from "@/lib/budget";
import type { CostCenter } from "@/lib/domain/types";
import type { ApiFn, BudgetCC } from "./budget-types";

export function CostCenterHeader({ cc, available, canEdit, api, onClone, onRemoved }: {
  cc: BudgetCC;
  /** Cost centres not already budgeted in this budget. */
  available: CostCenter[];
  canEdit: boolean;
  api: ApiFn;
  onClone: () => void;
  onRemoved: () => void;
}) {
  const t = useTranslations("budget.sheet");
  const tAlloc = useTranslations("allocation");
  const confirm = useConfirm();
  const linked = cc.costCenter;
  const url = `/api/budget-sheets/${cc.id}`;

  async function remove() {
    const ok = await confirm({
      title: t("removeTitle", { name: sheetName(cc, t("unnamed")) }),
      message: t("removeMessage"),
      confirmLabel: t("remove"),
      tone: "danger",
    });
    if (!ok) return;
    if (await api(url, "DELETE")) onRemoved();
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {linked ? (
          <>
            <span className="rounded-lg bg-surface px-2 py-1 font-mono text-xs font-semibold">{linked.code}</span>
            <h2 className="truncate text-sm font-semibold">{linked.name}</h2>
            <span className="text-xs text-muted">{linked.resultUnit ?? t("noResultUnit")}</span>
          </>
        ) : (
          <>
            <span className="rounded-lg bg-warning-soft px-2 py-1 text-xs font-medium text-warning">{t("unlinked")}</span>
            <h2 className="min-w-0 text-sm font-semibold">
              <EditableText
                value={cc.label ?? ""}
                label={t("renameSheet")}
                placeholder={t("sheetNamePlaceholder")}
                disabled={!canEdit}
                inputClassName="w-64"
                onSave={(v) => api(url, "PATCH", { label: v })}
              />
            </h2>
          </>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Searchable: a section has scores of cost centres, and the one you
              want is found by typing its code far quicker than by scrolling. */}
          <Combobox
            options={[
              { value: "", label: t("unlinked") },
              // The one it already points at stays in the list, so the current
              // value has a label to render; the rest are the free ones.
              ...(linked ? [{ value: linked.id, label: `${linked.code} – ${linked.name}`, short: linked.code }] : []),
              ...available.map((c) => ({ value: c.id, label: `${c.code} – ${c.name}`, short: c.code })),
            ]}
            value={linked?.id ?? ""}
            onChange={(v) => api(url, "PATCH", { costCenterId: v || null })}
            placeholder={t("linkTo")}
            searchPlaceholder={tAlloc("search")}
            emptyText={t("noFreeCostCenters")}
            aria-label={t("linkToAria")}
            className="w-56"
          />
          {/* The copy lands unconnected — the cost centre this one holds is
              taken, and which one the copy is for is the next thing to decide. */}
          <IconButton label={t("clone")} onClick={onClone}>
            <IconCopy className="size-4" />
          </IconButton>
          <IconButton label={t("removeFromBudget")} tone="danger" onClick={remove}>
            <IconTrash className="size-4" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
