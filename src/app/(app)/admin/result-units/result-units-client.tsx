"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import { type Column } from "@/components/ui/data-table";
import { EditableText } from "@/components/ui/editable-text";
import { FieldGroup, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash, IconX } from "@/components/ui/icons";
import { Modal, ModalBody, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Tag } from "@/components/ui/status-pill";
import { ExpandToggle } from "@/components/ui/expand-toggle";
import { useTableControls } from "@/lib/data/use-list-query";
import { cn } from "@/lib/ui/utils";
import type { ResultUnit, ResultUnitCostCenter } from "@/lib/domain/types";

type Mutate = ReturnType<typeof useMutation>["mutate"];

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

  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (resultUnits.find((u) => u.id === openId) ?? null) : null;
  const [showUnassigned, setShowUnassigned] = useState(false);
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
    if (typeof created.id === "string") setOpenId(created.id);
  }

  const columns: Column<ResultUnit>[] = [
    {
      key: "name",
      header: t("colName"),
      value: (u) => u.resultUnit,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (u) => (
        <button
          type="button"
          onClick={() => setOpenId(u.id)}
          className="text-left font-medium hover:text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
        >
          {u.resultUnit}
        </button>
      ),
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
    <div className="space-y-4">
      {unassignedActive > 0 && (
        <Notice>
          <p>
            {t("unassignedNotice", { count: unassignedActive })}{" "}
            <Button variant="link" type="button" onClick={() => setShowUnassigned(true)}>
              {t("showThem")}
            </Button>
          </p>
        </Notice>
      )}

      <Card>
        <ClientDataTable
          columns={columns}
          rows={resultUnits}
          controls={controls}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(u) => u.id}
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
      </Card>

      {open && (
        <UnitDialog
          key={open.id}
          unit={open}
          pending={pending}
          mutate={mutate}
          onClose={() => setOpenId(null)}
        />
      )}

      {showUnassigned && (
        <Modal
          label={t("unassigned")}
          onClose={() => setShowUnassigned(false)}
          className="max-w-lg"
        >
          <ModalHeader title={t("unassigned")} subtitle={t("unassignedSubtitle")} />
          <ModalBody>
            <CostCenterList list={unassigned} />
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}

function UnitDialog({
  unit,
  pending,
  mutate,
  onClose,
}: {
  unit: ResultUnit;
  pending: string | null;
  mutate: Mutate;
  onClose: () => void;
}) {
  const t = useTranslations("admin.resultUnits");
  const tCommon = useTranslations("common");
  const tCostCenters = useTranslations("admin.costCenters");
  const tRole = useTranslations("common.role");
  const confirm = useConfirm();

  const [prefixDraft, setPrefixDraft] = useState<string | null>(null);
  const [showCostCenters, setShowCostCenters] = useState(false);

  async function rename(raw: string) {
    const name = raw.trim();
    if (!name) return false;
    return mutate(`/api/result-units/${unit.id}`, {
      key: `name-${unit.id}`,
      method: "PATCH",
      body: { name },
      error: t("renameFailed"),
      success: t("renamed", { name }),
    }).then((ok) => ok !== null);
  }

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
    });
    if (ok) onClose();
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

  return (
    <Modal label={unit.resultUnit} onClose={onClose} className="max-w-2xl">
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-inset py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">
            <EditableText
              value={unit.resultUnit}
              label={t("renameAria", { name: unit.resultUnit })}
              onSave={rename}
            />
          </h2>
          <p className="px-1.5 text-sm text-muted">
            {t("activeCostCenters", { count: unit.costCenterCount })}
          </p>
        </div>
        <IconButton
          tone="danger"
          onClick={remove}
          loading={pending === unit.id}
          label={t("deleteAria", { name: unit.resultUnit })}
        >
          <IconTrash className="size-4" />
        </IconButton>
        <IconButton label={tCommon("close")} onClick={onClose}>
          <IconX className="size-4" />
        </IconButton>
      </div>

      <ModalBody>
        <Section title={t("sectionCostCenters")} hint={t("sectionCostCentersHint")}>
          <FieldGroup label={t("prefixes")}>
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
          </FieldGroup>

          {unit.costCenters.length === 0 ? (
            <p className="text-sm text-muted">
              {unit.prefixes.length ? t("noCostCentersForPrefix") : t("noPrefixHint")}
            </p>
          ) : (
            <div>
              <ExpandToggle
                open={showCostCenters}
                onToggle={() => setShowCostCenters(!showCostCenters)}
                className="-ml-2"
              >
                {t("matches", { count: unit.costCenters.length })}
              </ExpandToggle>
              {showCostCenters && (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-control border border-border">
                  <CostCenterList list={unit.costCenters} />
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title={t("sectionAttest")} hint={t("sectionAttestHint")}>
          <FieldGroup label={tRole("RESULTATANSVARIG")}>
            {unit.owners.length === 0 ? (
              <p className="text-sm text-muted">
                {unit.ownerGroups.length ? t("noOwnersHolding") : t("noOwnerGroups")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {unit.owners.map((u) => (
                  <span
                    key={u.id}
                    className="h-7 rounded-control border border-accent bg-accent-soft px-3 text-xs font-medium leading-7 text-accent"
                  >
                    {u.name}
                  </span>
                ))}
              </div>
            )}
          </FieldGroup>
          <p className="text-xs text-muted">
            {unit.ownerGroups.length > 0 && (
              <>
                {t("grantedBy")}{" "}
                {unit.ownerGroups.map((g, i) => (
                  <span key={g}>
                    {i > 0 && ", "}
                    <code className="rounded-control bg-surface-2 px-1 py-0.5 font-mono">{g}</code>
                  </span>
                ))}
                .{" "}
              </>
            )}
            <Link
              href="/admin/roles"
              className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
            >
              {t("editInRoles")}
            </Link>
          </p>
        </Section>

        <Section title={t("sectionSales")} hint={t("sectionSalesHint")}>
          <p className="text-sm">
            {unit.income
              ? t("salesOnSummary", { count: unit.income.prefixes.length })
              : t("salesOffSummary")}{" "}
            <Link
              href="/admin/income#units"
              className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
            >
              {t("editInSales")}
            </Link>
          </p>
        </Section>
      </ModalBody>
    </Modal>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-b border-border pb-5 last:border-0 last:pb-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function CostCenterList({ list }: { list: ResultUnitCostCenter[] }) {
  const t = useTranslations("admin.resultUnits");
  if (list.length === 0) return <p className="text-sm text-muted">{t("unassignedEmpty")}</p>;
  const sorted = [...list].sort((a, b) => Number(b.active) - Number(a.active));
  return (
    <ul>
      {sorted.map((cc) => (
        <li
          key={cc.code}
          className={cn(
            "flex items-center gap-4 border-b border-border px-3 py-2 last:border-0",
            !cc.active && "opacity-55",
          )}
        >
          <span className="w-20 shrink-0 font-mono text-xs font-semibold">{cc.code}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{cc.name}</span>
          {!cc.active && <span className="text-xs text-muted">{t("inactive")}</span>}
        </li>
      ))}
    </ul>
  );
}
