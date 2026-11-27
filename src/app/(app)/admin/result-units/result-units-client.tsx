"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { SettingsCard, SettingsStack } from "@/components/settings/settings-card";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { ClientDataTable } from "@/components/ui/client-data-table";
import { type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/field";
import { IconPlus } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls } from "@/lib/data/use-list-query";
import type { ResultUnit, ResultUnitCostCenter } from "@/lib/domain/types";
import { CostCenterList } from "./cost-center-list";

export function ResultUnitsClient({
  resultUnits,
  unassigned,
}: {
  resultUnits: ResultUnit[];
  unassigned: ResultUnitCostCenter[];
}) {
  const t = useTranslations("admin.resultUnits");
  const tCommon = useTranslations("common");
  const { pending, mutate } = useMutation();
  const controls = useTableControls({ sortKey: "name" });

  const router = useProgressRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const unassignedActive = unassigned.filter((cc) => cc.active).length;

  async function createResultUnit() {
    const name = newName.trim();
    if (!name) return;
    const created = await mutate("/api/result-units", {
      key: "new-resultUnit",
      body: { name },
      error: t("createFailed"),
      success: t("created", { name }),
    });
    if (!created) return;
    setNewName("");
    setAdding(false);
    if (typeof created.id === "string") router.push(`/admin/result-units/${created.id}`);
  }

  const columns: Column<ResultUnit>[] = [
    {
      key: "name",
      header: t("colName"),
      value: (u) => u.resultUnit,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (u) => <span className="font-medium">{u.resultUnit}</span>,
    },
    {
      key: "prefixes",
      mobile: "meta",
      mobileCell: (u) => u.prefixes.map((p) => p.value).join(", "),
      header: t("colPrefixes"),
      value: (u) => u.prefixes.map((p) => p.value).join(" "),
      searchable: true,
      cell: (u) =>
        u.prefixes.length ? (
          <span className="flex flex-wrap gap-1">
            {u.prefixes.map((p) => (
              <Tag key={p.id} className="font-mono font-semibold">
                {p.value}
              </Tag>
            ))}
          </span>
        ) : (
          <span className="text-xs text-warning">{t("noPrefix")}</span>
        ),
    },
    {
      key: "count",
      mobile: "hide",
      header: t("colCount"),
      value: (u) => u.costCenterCount,
      sortable: true,
      align: "right",
      className: "tabular-nums",
      cell: (u) => u.costCenterCount,
    },
    {
      key: "owners",
      mobile: "meta",
      mobileCell: (u) => u.owners.map((o) => o.name).join(", "),
      header: t("colOwners"),
      value: (u) => u.owners.map((o) => o.name).join(", "),
      sortable: true,
      searchable: true,
      cell: (u) =>
        u.owners.length ? (
          <span className="text-sm">{u.owners.map((o) => o.name).join(", ")}</span>
        ) : (
          <span className="text-xs text-warning">{t("noOwners")}</span>
        ),
    },
    {
      key: "sales",
      header: t("colSales"),
      value: (u) => (u.income ? 1 : 0),
      sortable: true,
      mobile: "trailing",
      cell: (u) =>
        u.income ? <Tag tone="accent">{t("salesOn")}</Tag> : <span className="text-muted">-</span>,
    },
  ];

  return (
    <SettingsStack>
      {unassignedActive > 0 && (
        <Notice>
          <p>
            {t("unassignedNotice", { count: unassignedActive })}{" "}
            <a href="#unassigned" className="font-medium link">
              {t("showThem")}
            </a>
          </p>
        </Notice>
      )}

      <SettingsCard>
        <ClientDataTable
          columns={columns}
          rows={resultUnits}
          controls={controls}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(u) => u.id}
          rowHref={(u) => `/admin/result-units/${u.id}`}
          empty={resultUnits.length === 0 ? t("emptyNone") : t("emptyNoMatch")}
          action={
            !adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <IconPlus className="size-4" />
                {t("new")}
              </Button>
            )
          }
          actionPanel={
            adding && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-48 flex-1 sm:max-w-sm">
                  <Input
                    size="sm"
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && pending !== "new-resultUnit") createResultUnit();
                      if (e.key === "Escape") setAdding(false);
                    }}
                    placeholder={t("namePlaceholder")}
                    aria-label={t("namePlaceholder")}
                  />
                </div>
                <Button
                  size="sm"
                  loading={pending === "new-resultUnit"}
                  disabled={!newName.trim()}
                  onClick={createResultUnit}
                >
                  {t("create")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                  {tCommon("cancel")}
                </Button>
              </div>
            )
          }
        />
      </SettingsCard>

      {unassigned.length > 0 && (
        <SettingsCard id="unassigned" title={t("unassigned")}>
          <CostCenterList list={unassigned} />
        </SettingsCard>
      )}
    </SettingsStack>
  );
}
