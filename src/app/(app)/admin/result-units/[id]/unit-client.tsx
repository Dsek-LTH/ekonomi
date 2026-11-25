"use client";

// One result unit: which cost centres are its, which Authentik groups answer for it, and whether it sells.
// Everything about the unit is edited here except its sales, which the Försäljning page sets up unit by unit.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import {
  SettingRow,
  SettingsCard,
  SettingsGroup,
  SettingsRows,
  SettingsStack,
} from "@/components/settings/settings-card";
import { useProgressRouter } from "@/components/shell/route-progress";
import {
  SettingsForm,
  SettingsLink,
  useDraft,
  useDraftPart,
} from "@/components/settings/settings-draft";
import { useMutation } from "@/components/shell/use-mutation";
import { Button, SOFT_FILL, SOFT_HOVER } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { MultiCombobox } from "@/components/ui/combobox";
import { EditableText } from "@/components/ui/editable-text";
import { Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconDots, IconPlus, IconTrash } from "@/components/ui/icons";
import { Menu, MenuItem } from "@/components/ui/menu";
import type { ResultUnit } from "@/lib/domain/types";
import { CostCenterList } from "../cost-center-list";

const LINK =
  "font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current";

export function UnitClient(props: { unit: ResultUnit; knownGroups: string[] }) {
  return (
    <SettingsForm>
      <Unit {...props} />
    </SettingsForm>
  );
}

// The name and the groups wait for the page's Spara. Prefixes are rows, added and removed at once.
function Unit({ unit, knownGroups }: { unit: ResultUnit; knownGroups: string[] }) {
  const t = useTranslations("admin.resultUnits");
  const tCommon = useTranslations("common");
  const tCostCenters = useTranslations("admin.costCenters");
  const tRole = useTranslations("common.role");
  const confirm = useConfirm();
  const router = useProgressRouter();
  const { pending, mutate } = useMutation();

  const [prefixDraft, setPrefixDraft] = useState<string | null>(null);
  const draft = useDraft({ name: unit.resultUnit, groups: unit.ownerGroups });
  const groups = draft.value.groups;

  function rename(raw: string) {
    const name = raw.trim();
    if (!name) return false;
    draft.set("name", name);
    return true;
  }

  useDraftPart({
    dirty: draft.dirty,
    save: async () => {
      const { name, groups: next } = draft.changes;
      if (name !== undefined) {
        const ok = await mutate(`/api/result-units/${unit.id}`, {
          method: "PATCH",
          body: { name },
          error: t("renameFailed"),
          refresh: false,
        });
        if (ok === null) return false;
      }
      if (next !== undefined) {
        const ok = await mutate(`/api/result-units/${unit.id}/groups`, {
          method: "PUT",
          body: { groups: next },
          error: t("saveFailed"),
          refresh: false,
        });
        if (ok === null) return false;
      }
      return true;
    },
    commit: draft.commit,
    reset: draft.reset,
  });

  async function remove() {
    const confirmed = await confirm({
      title: t("deleteTitle", { name: unit.resultUnit }),
      message:
        unit.prefixes.length > 0
          ? t("deleteMessagePrefixes", {
              prefixes: unit.prefixes.map((p) => p.value).join(", "),
            })
          : t("deleteMessage"),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    const ok = await mutate(`/api/result-units/${unit.id}`, {
      key: unit.id,
      method: "DELETE",
      error: t("deleteFailed"),
      success: t("deleted", { name: unit.resultUnit }),
      refresh: false,
    });
    if (ok) router.replace("/admin/result-units");
  }

  async function addPrefix() {
    const value = (prefixDraft ?? "").trim();
    if (!value) return;
    const ok = await mutate(`/api/result-units/${unit.id}/prefixes`, {
      key: `prefix-${unit.id}`,
      body: { value },
      error: t("prefixAddFailed"),
    });
    if (ok) setPrefixDraft(null);
  }

  async function removePrefix(prefixId: string, value: string) {
    await mutate(`/api/result-units/prefixes/${prefixId}`, {
      key: prefixId,
      method: "DELETE",
      error: t("prefixRemoveFailed"),
      success: t("prefixRemoved", { prefix: value }),
    });
  }

  const saveGroups = (next: string[]) => draft.set("groups", next);

  // Every group anybody holds, and the ones already chosen even if nobody holds them (a typo shows as held by none).
  const groupOptions = [...new Set([...knownGroups, ...groups])]
    .sort()
    .map((g) => ({ value: g, label: g }));

  return (
    <PageShell
      title={
        <EditableText
          value={draft.value.name}
          label={t("renameAria", { name: draft.value.name })}
          onSave={rename}
        />
      }
      back="/admin/result-units"
      menu={
        <Menu
          label={t("unitActions", { name: unit.resultUnit })}
          iconOnly
          variant="ghost"
          size="sm"
          loading={pending === unit.id}
          icon={<IconDots className="size-4" />}
        >
          <MenuItem onClick={remove} className="text-danger hover:bg-danger-soft">
            <IconTrash className="size-4 shrink-0" />
            {t("delete")}
          </MenuItem>
        </Menu>
      }
    >
      <SettingsStack>
        <SettingsCard title={t("sectionCostCenters")}>
          <SettingsRows>
            <SettingRow label={t("prefixes")} wide>
              <div className="flex flex-wrap items-center gap-2">
                {unit.prefixes.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1.5 rounded-control border border-border bg-background py-1 pl-3 pr-1.5 font-mono text-xs font-semibold"
                  >
                    {p.value}
                    <IconButton
                      tone="danger"
                      onClick={() => removePrefix(p.id, p.value)}
                      loading={pending === p.id}
                      size="xs"
                      label={t("prefixRemoveAria", { prefix: p.value })}
                    >
                      <IconTrash className="size-3.5" />
                    </IconButton>
                  </span>
                ))}

                {prefixDraft === null ? (
                  <Button variant="ghost" size="sm" onClick={() => setPrefixDraft("")}>
                    <IconPlus className="size-4" />
                    {t("prefixAdd")}
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-24">
                      <Input
                        size="sm"
                        autoFocus
                        value={prefixDraft}
                        onChange={(e) => setPrefixDraft(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && pending !== `prefix-${unit.id}`) addPrefix();
                          if (e.key === "Escape") setPrefixDraft(null);
                        }}
                        placeholder="SKT"
                        aria-label={t("prefixNew")}
                        className="font-mono uppercase"
                      />
                    </span>
                    <Button
                      size="sm"
                      loading={pending === `prefix-${unit.id}`}
                      disabled={!prefixDraft.trim()}
                      onClick={addPrefix}
                    >
                      {tCostCenters("add")}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setPrefixDraft(null)}>
                      {tCommon("cancel")}
                    </Button>
                  </span>
                )}
              </div>
            </SettingRow>
          </SettingsRows>
          {unit.costCenters.length === 0 ? (
            <p className="border-t border-border px-inset py-3 text-sm text-muted">
              {unit.prefixes.length ? t("noCostCentersForPrefix") : t("noPrefixHint")}
            </p>
          ) : (
            <div className="border-t border-border">
              <SettingsGroup title={t("matches", { count: unit.costCenters.length })}>
                <li>
                  <CostCenterList list={unit.costCenters} />
                </li>
              </SettingsGroup>
            </div>
          )}
        </SettingsCard>

        <SettingsCard title={tRole("RESULTATANSVARIG")}>
          <SettingsRows>
            <SettingRow label={t("ownerGroups")} wide>
              <MultiCombobox
                size="sm"
                options={groupOptions}
                values={groups}
                onChange={saveGroups}
                onCreate={(text) => saveGroups([...groups, text.trim().toLowerCase()])}
                createLabel={(text) => t("useGroup", { group: text.trim().toLowerCase() })}
                placeholder={t("noOwnerGroupsPlaceholder")}
                searchPlaceholder={t("searchGroups")}
                aria-label={t("ownerGroups")}
              />
            </SettingRow>
            <SettingRow label={t("ownersNow")} wide>
              {unit.owners.length === 0 ? (
                <p className="text-sm text-muted">
                  {groups.length ? t("noOwnersHolding") : t("noOwners")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {unit.owners.map((u) => (
                    <SettingsLink
                      key={u.id}
                      href={`/admin/users/${u.id}`}
                      className={cn(
                        "h-7 rounded-control px-3 text-xs font-medium leading-7",
                        SOFT_FILL,
                        SOFT_HOVER,
                      )}
                    >
                      {u.name}
                    </SettingsLink>
                  ))}
                </div>
              )}
            </SettingRow>
          </SettingsRows>
        </SettingsCard>

        <SettingsCard title={t("sectionSales")}>
          <SettingsRows>
            <SettingRow
              label={
                unit.income
                  ? t("salesOnSummary", { count: unit.income.prefixes.length })
                  : t("salesOffSummary")
              }
            >
              <div className="sm:text-right">
                <SettingsLink href="/admin/income#units" className={`text-sm ${LINK}`}>
                  {t("editInSales")}
                </SettingsLink>
              </div>
            </SettingRow>
          </SettingsRows>
        </SettingsCard>
      </SettingsStack>
    </PageShell>
  );
}
