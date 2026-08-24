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
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { IconCopy, IconTrash } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { sheetName } from "@/lib/budget";
import type { CostCenter } from "@/lib/domain/types";
import type { ApiFn, BudgetCC } from "./budget-types";

export function CostCenterHeader({ cc, available, canEdit, api, onClone, onCopyContents, onRemoved }: {
  cc: BudgetCC;
  /** Cost centres not already budgeted in this budget. */
  available: CostCenter[];
  canEdit: boolean;
  api: ApiFn;
  onClone: () => void;
  /** Copy every account of this sheet, to be pasted into another one. */
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
    // Two rows below sm, one from sm up.
    //
    // It was a single `flex-wrap` row holding a 224px combobox, a text link and
    // two icon buttons — on 361px of phone the combobox alone took the width, so
    // the group wrapped into a ragged three or four lines and left the remove
    // button sitting inline beside a text link. Which is the part that read
    // wrong rather than merely looked untidy: a destructive action should not be
    // one of a row of equals.
    //
    // So identity and the overflow menu share the top line, the picker takes the
    // width it needs under them, and everything that acts on the sheet as a
    // whole is in the menu — where "Ta bort" is below a rule instead of beside
    // a link.
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-background px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
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
        <div className="flex items-center gap-2">
          {/* Searchable: a section has scores of cost centres, and the one you
              want is found by typing its code far quicker than by scrolling.
              It stays out of the menu because it is the field that ends the
              unlinked state, which is the one thing a sheet in that state is
              waiting for — and a field you set is not an action you pick. */}
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
            className="min-w-0 flex-1 sm:w-56 sm:flex-none"
          />
          {/* Named rather than a bare glyph. The three things in here act on
              the sheet as a whole — one of them removes it from the budget —
              and a row of unlabelled icons is how somebody duplicates a sheet
              meaning to copy its contents. */}
          <Menu label={t("sheetActions")} variant="secondary" align="end" className="shrink-0">
            {/* Copying the contents, as against cloning the sheet: this one puts
                every account on the clipboard to be pasted into a cost centre
                that already exists. A row or a single account is copied from the
                sheet itself with ⌘C — there is nothing to stand in for a whole
                sheet, so it says so in words. */}
            {cc.accounts.length > 0 && (
              <MenuItem onClick={onCopyContents}>{t("copyContents")}</MenuItem>
            )}
            {/* The copy lands unconnected — the cost centre this one holds is
                taken, and which one the copy is for is the next thing to decide. */}
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
