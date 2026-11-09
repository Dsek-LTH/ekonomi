// The bar above a cost-centre sheet: which cost centre it is, and repoint, duplicate or drop.
// A sheet need not be linked (BudgetCostCenter in schema.prisma): its name is then an editable
// label and the picker ends that state.
"use client";

import { useTranslations } from "next-intl";
import { Combobox } from "@/components/ui/combobox";
import { EditableText } from "@/components/ui/editable-text";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { IconCopy, IconTrash } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/confirm-dialog";
import { sheetName } from "@/lib/budget";
import type { CostCenter } from "@/lib/domain/types";
import type { ApiFn, BudgetCC } from "./budget-types";

export function CostCenterHeader({
  cc,
  available,
  canEdit,
  api,
  onClone,
  onCopyContents,
  onRemoved,
}: {
  cc: BudgetCC;
  available: CostCenter[];
  canEdit: boolean;
  api: ApiFn;
  onClone: () => void;
  onCopyContents: () => void;
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
    // Two rows below sm, one from sm up: identity and the menu share the top line, the picker
    // sits under them, and everything acting on the whole sheet is in the menu so "Ta bort" is
    // not one of a row of equals.
    <div className="mb-4 flex flex-col gap-3 rounded-panel border border-border bg-background px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {linked ? (
          <>
            <span className="rounded-control bg-surface px-2 py-1 font-mono text-xs font-semibold">
              {linked.code}
            </span>
            <h2 className="truncate text-sm font-semibold">{linked.name}</h2>
            <span className="text-xs text-muted">{linked.resultUnit ?? t("noResultUnit")}</span>
          </>
        ) : (
          <>
            <Tag tone="warning">{t("unlinked")}</Tag>
            <h2 className="min-w-0 text-sm font-semibold">
              <EditableText
                value={cc.label ?? ""}
                label={t("renameSheet")}
                placeholder={t("sheetNamePlaceholder")}
                disabled={!canEdit}
                onSave={(v) => api(url, "PATCH", { label: v })}
              />
            </h2>
          </>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          {/* The picker is not in the menu: it is the field that ends the unlinked state. */}
          <Combobox
            options={[
              { value: "", label: t("unlinked") },
              // The current one stays in the list so its value has a label.
              ...(linked
                ? [
                    {
                      value: linked.id,
                      label: `${linked.code} - ${linked.name}`,
                      short: linked.code,
                    },
                  ]
                : []),
              ...available.map((c) => ({
                value: c.id,
                label: `${c.code} - ${c.name}`,
                short: c.code,
              })),
            ]}
            value={linked?.id ?? ""}
            onChange={(v) => api(url, "PATCH", { costCenterId: v || null })}
            placeholder={t("linkTo")}
            searchPlaceholder={tAlloc("search")}
            emptyText={t("noFreeCostCenters")}
            aria-label={t("linkToAria")}
            className="min-w-0 flex-1 sm:w-56 sm:flex-none"
          />

          <Menu label={t("sheetActions")} variant="secondary" align="end" className="shrink-0">
            {cc.accounts.length > 0 && (
              <MenuItem onClick={onCopyContents}>{t("copyContents")}</MenuItem>
            )}

            <MenuItem onClick={onClone}>
              <IconCopy className="size-4" />
              {t("clone")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={remove} className="text-danger hover:bg-danger-soft">
              <IconTrash className="size-4" />
              {t("removeFromBudget")}
            </MenuItem>
          </Menu>
        </div>
      )}
    </div>
  );
}
