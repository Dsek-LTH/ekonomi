"use client";

// Settings → Cost centers. The Fortnox-owned ones are mirrored here by
// the sync and read-only (the next sync would overwrite anything changed here);
// the local ones are this app's own and fully editable.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { type Column } from "@/components/ui/data-table";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import { FieldGroup, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPencil, IconPlus, IconSync, IconTrash } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls } from "@/lib/data/use-list-query";
import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { cn } from "@/lib/ui/utils";
import type { CostCenter } from "@/lib/domain/types";

// Retired cost centres stay in the list — seeing that SEX02 exists but is
// inactive is what explains why it isn't in the picker — but the default filter
// is the active ones, since that is the list anyone is normally looking for.
export function CostCentersClient({
  costCenters,
  connected,
}: {
  costCenters: CostCenter[];
  connected: boolean; // Fortnox service connection — without it there is nothing to sync from
}) {
  const t = useTranslations("admin.costCenters");
  const tCommon = useTranslations("common");
  const tBookkeeping = useTranslations("bookkeeping");
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const controls = useTableControls();

  const tabs: ClientTabFilter<CostCenter> = [
    { value: "active", label: t("tab.active"), predicate: (c) => c.active },
    { value: "local", label: t("tab.local"), predicate: (c) => c.source === "LOCAL" },
    { value: "inactive", label: t("tab.inactive"), predicate: (c) => !c.active },
    { value: "all", label: t("tab.all") },
  ];

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ code: "", name: "" });
  // The row being renamed, and the name being typed for it.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  async function sync() {
    const data = await mutate("/api/cost-centers/sync", {
      key: "sync",
      error: t("syncFailed"),
    });
    if (!data) return;
    const updated = Number(data.upserted);
    const retired = Number(data.deactivated);
    const deleted = Number(data.deleted);
    notify.success(
      retired && deleted
        ? t("syncSummaryWithRetiredAndDeleted", { updated, retired, deleted })
        : deleted
          ? t("syncSummaryWithDeleted", { updated, deleted })
          : retired
            ? t("syncSummaryWithRetired", { updated, retired })
            : t("syncSummary", { updated }),
      t("syncDone"),
    );
  }

  async function add() {
    const code = draft.code.trim().toUpperCase();
    const data = await mutate("/api/cost-centers", {
      key: "new",
      body: { code, name: draft.name.trim() },
      error: t("createFailed"),
      success: t("created", { code }),
    });
    if (!data) return;
    setDraft({ code: "", name: "" });
    setAdding(false);
  }

  async function saveName(cc: CostCenter) {
    const name = renaming?.name.trim();
    if (!name) return;
    const data = await mutate(`/api/cost-centers/${cc.id}`, {
      key: `name-${cc.id}`,
      method: "PATCH",
      body: { name },
      error: t("renameFailed"),
      success: t("renamed", { code: cc.code, name }),
    });
    if (data) setRenaming(null);
  }

  // Retiring is the reversible half of removing one: it drops out of the
  // pickers while everything already booked against it keeps resolving.
  async function setActive(cc: CostCenter, active: boolean) {
    await mutate(`/api/cost-centers/${cc.id}`, {
      key: `active-${cc.id}`,
      method: "PATCH",
      body: { active },
      error: t("updateFailed"),
      success: t(active ? "activated" : "deactivated", { code: cc.code }),
    });
  }

  async function remove(cc: CostCenter) {
    const ok = await confirm({
      title: t("deleteTitle", { code: cc.code }),
      message: t("deleteMessage"),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!ok) return;
    const data = await mutate(`/api/cost-centers/${cc.id}`, {
      key: `delete-${cc.id}`,
      method: "DELETE",
      error: t("deleteFailed"),
    });
    if (!data) return;
    notify.success(t(data.retired ? "deactivated" : "deleted", { code: cc.code }));
  }

  const columns: Column<CostCenter>[] = [
    {
      key: "code",
      header: t("colCode"),
      value: (c) => c.code,
      sortable: true,
      searchable: true,
      mobile: "title",
      className: "w-40",
      cell: (c) => <Tag className="font-mono font-semibold">{c.code}</Tag>,
    },
    {
      key: "name",
      header: t("colName"),
      value: (c) => c.name,
      sortable: true,
      searchable: true,
      className: "font-medium",
      cell: (c) =>
        renaming?.id === c.id ? (
          // Wraps rather than shrinks: in the phone card this sits in a
          // right-aligned meta row, where input + two buttons don't fit a line.
          <div className="flex flex-wrap items-center justify-end gap-2 md:justify-start">
            <Input
              size="sm"
              autoFocus
              value={renaming.name}
              onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName(c);
                if (e.key === "Escape") setRenaming(null);
              }}
              aria-label={t("colName")}
              className="min-w-40 flex-1 text-left"
            />
            <Button
              size="sm"
              loading={pending === `name-${c.id}`}
              disabled={!renaming.name.trim()}
              onClick={() => saveName(c)}
            >
              {t("save")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setRenaming(null)}>
              {tCommon("cancel")}
            </Button>
          </div>
        ) : (
          c.name
        ),
    },
    {
      key: "resultUnit",
      header: t("colResultUnit"),
      value: (c) => c.resultUnit ?? "",
      sortable: true,
      searchable: true,
      cell: (c) =>
        c.resultUnit ? (
          <Tag>{c.resultUnit}</Tag>
        ) : (
          // Nothing attests these but an administrator, so it's worth naming
          // rather than leaving the cell blank.
          <span className="text-xs text-muted">{t("noResultUnit")}</span>
        ),
    },
    {
      key: "source",
      header: t("colSource"),
      value: (c) => c.source,
      sortable: true,
      cell: (c) =>
        c.source === "LOCAL" ? (
          <span title={t("localHint")}>
            <Tag tone="accent" className="font-medium">{t("local")}</Tag>
          </span>
        ) : (
          <span title={t("fortnoxHint")}>
            <Tag>Fortnox</Tag>
          </span>
        ),
    },
    {
      key: "status",
      header: t("colStatus"),
      value: (c) => (c.active ? 1 : 0),
      sortable: true,
      mobile: "trailing",
      cell: (c) =>
        c.active ? (
          <span className="text-xs text-muted">{t("active")}</span>
        ) : (
          <Tag tone="warning">{t("inactive")}</Tag>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      className: "w-56",
      // Only the local ones are ours to change — a Fortnox row edited here would
      // just come back as it was on the next sync.
      cell: (c) =>
        c.source === "LOCAL" && (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              loading={pending === `active-${c.id}`}
              onClick={() => setActive(c, !c.active)}
            >
              {t(c.active ? "deactivate" : "activate")}
            </Button>
            <IconButton
              label={t("renameAria", { code: c.code })}
              disabled={renaming?.id === c.id}
              onClick={() => setRenaming({ id: c.id, name: c.name })}
            >
              <IconPencil className="size-4" />
            </IconButton>
            <IconButton
              tone="danger"
              label={t("deleteAria", { code: c.code })}
              loading={pending === `delete-${c.id}`}
              onClick={() => remove(c)}
            >
              <IconTrash className="size-4" />
            </IconButton>
          </div>
        ),
    },
  ];

  return (
    <>
      {adding && (
        <Card>
          <CardHeader
            title={t("newLocalTitle")}
            subtitle={t("newLocalSubtitle")}
          />
          <CardBody>
            <FieldGroup label={t("codeAndName")} hint={t("codeAndNameHint")}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-40">
                  <Input
                    size="sm"
                    autoFocus
                    value={draft.code}
                    onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                    onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                    placeholder="SEX-ALKO"
                    aria-label={t("colCode")}
                    className="font-mono uppercase"
                  />
                </div>
                <div className="min-w-48 flex-1">
                  <Input
                    size="sm"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                    placeholder={t("colName")}
                    aria-label={t("colName")}
                  />
                </div>
                <Button
                  size="sm"
                  loading={pending === "new"}
                  disabled={!draft.code.trim() || !draft.name.trim()}
                  onClick={add}
                >
                  <IconPlus className="size-4" />
                  {t("add")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                  {tCommon("cancel")}
                </Button>
              </div>
            </FieldGroup>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={t("title")}
          subtitle={t("subtitle")}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <IconButton
                label={pending === "sync" ? t("syncing") : t("sync")}
                title={connected ? undefined : tBookkeeping("connectFirst")}
                disabled={!connected || pending === "sync"}
                onClick={sync}
              >
                <IconSync className={cn("size-4", pending === "sync" && "animate-spin")} />
              </IconButton>
              {!adding && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <IconPlus className="size-4" />
                  {t("newLocal")}
                </Button>
              )}
            </div>
          }
        />
        <ClientDataTable
          columns={columns}
          rows={costCenters}
          controls={controls}
          tabs={tabs}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(c) => c.id}
          rowClassName={(c) => cn(!c.active && "opacity-55")}
          empty={
            costCenters.length === 0 ? t("emptyNone") : t("emptyNoMatch")
          }
        />
      </Card>
    </>
  );
}
