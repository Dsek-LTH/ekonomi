"use client";

// Settings → Result units. A result unit owns one or more cost-centre code
// prefixes; every cost centre whose code starts with one of them belongs to it,
// and its resultatansvariga hold approval authority over those expenses. A unit
// that takes money in also says how its sales are booked.
//
// One table of every unit, and the unit itself in a dialog over it. It was a
// list down the side and the selected unit beside it, which meant reading the
// setup one unit at a time: whether every unit had a prefix and somebody
// answering for it took a click per unit to find out. The table answers that
// at a glance, and the dialog is where one unit is changed.
//
// Cost centres with no result unit are not a unit, so they are not a row. They
// are a warning above the table while there are any, which is what they are:
// expenses only an administrator can attest.
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import { Combobox } from "@/components/ui/combobox";
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
import type { CostCenter, ResultUnit, ResultUnitCostCenter } from "@/lib/domain/types";

type Mutate = ReturnType<typeof useMutation>["mutate"];

export function ResultUnitsClient({
  resultUnits,
  unassigned,
  costCenters,
  incomeEnabled,
}: {
  resultUnits: ResultUnit[];
  /** Cost centres no unit's prefix matches. */
  unassigned: ResultUnitCostCenter[];
  /** For the sales section's cost-centre picker. */
  costCenters: CostCenter[];
  /** False when the app runs without the intakt service. See intaktConfigured. */
  incomeEnabled: boolean;
}) {
  const t = useTranslations("admin.resultUnits");
  const tCommon = useTranslations("common");
  const { pending, mutate } = useMutation();
  const controls = useTableControls({ sortKey: "name" });

  // The open unit by id, so the dialog follows the refreshed row after every
  // save rather than holding on to the copy it was opened with.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? resultUnits.find((u) => u.id === openId) ?? null : null;
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
    // Straight into it: a new unit is nothing until it has a prefix.
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
      // A button, not a click on the row: it is a tab stop, it answers Enter,
      // and a screen reader says it opens something.
      cell: (u) => (
        <button
          type="button"
          onClick={() => setOpenId(u.id)}
          className="text-left font-medium hover:text-accent hover:underline"
        >
          {u.resultUnit}
        </button>
      ),
    },
    {
      key: "prefixes",
      header: t("colPrefixes"),
      value: (u) => u.prefixes.map((p) => p.value).join(" "),
      searchable: true,
      cell: (u) =>
        u.prefixes.length ? (
          <span className="flex flex-wrap gap-1">
            {u.prefixes.map((p) => (
              <Tag key={p.id} className="font-mono font-semibold">{p.value}</Tag>
            ))}
          </span>
        ) : (
          // A unit without one owns nothing, which is worth seeing from here.
          <span className="text-xs text-warning">{t("noPrefix")}</span>
        ),
    },
    {
      key: "count",
      header: t("colCount"),
      value: (u) => u.costCenterCount,
      sortable: true,
      align: "right",
      className: "tabular-nums",
      cell: (u) => u.costCenterCount,
    },
    {
      key: "owners",
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
      hidden: !incomeEnabled,
      value: (u) => (u.income ? 1 : 0),
      sortable: true,
      mobile: "trailing",
      cell: (u) =>
        u.income ? (
          <Tag tone="accent">{t("salesOn")}</Tag>
        ) : (
          <span className="text-muted">–</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {unassignedActive > 0 && (
        <Notice>
          <p>
            {t("unassignedNotice", { count: unassignedActive })}{" "}
            <button
              type="button"
              onClick={() => setShowUnassigned(true)}
              className="font-medium text-accent hover:underline"
            >
              {t("showThem")}
            </button>
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
          // Keyed, so every draft inside starts over when another unit opens.
          key={open.id}
          unit={open}
          costCenters={costCenters}
          incomeEnabled={incomeEnabled}
          pending={pending}
          mutate={mutate}
          onClose={() => setOpenId(null)}
        />
      )}

      {showUnassigned && (
        <Modal label={t("unassigned")} onClose={() => setShowUnassigned(false)} className="max-w-lg">
          <ModalHeader title={t("unassigned")} subtitle={t("unassignedSubtitle")} />
          <ModalBody>
            <CostCenterList list={unassigned} />
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}

/**
 * One result unit, in three sections that each answer one question: which
 * cost centres are its, who attests them, and how its sales are booked.
 */
function UnitDialog({
  unit,
  costCenters,
  incomeEnabled,
  pending,
  mutate,
  onClose,
}: {
  unit: ResultUnit;
  costCenters: CostCenter[];
  incomeEnabled: boolean;
  pending: string | null;
  mutate: Mutate;
  onClose: () => void;
}) {
  const t = useTranslations("admin.resultUnits");
  const tIncome = useTranslations("admin.resultUnits.income");
  const tCommon = useTranslations("common");
  const tCostCenters = useTranslations("admin.costCenters");
  const tRole = useTranslations("common.role");
  const confirm = useConfirm();

  // The prefix input is hidden behind a + until asked for, so the prefixes
  // read as data rather than as a form. null means "not adding".
  const [prefixDraft, setPrefixDraft] = useState<string | null>(null);
  const [productDraft, setProductDraft] = useState<{ code: string; account: string } | null>(null);
  const [showCostCenters, setShowCostCenters] = useState(false);

  // Only the unit's own cost centres: its sales are attested by its own
  // resultatansvariga, which another unit's cost centre would hand to someone
  // else. The one already chosen stays offered if it no longer matches (a
  // prefix removed since), so the picker shows it rather than going blank.
  const ownCodes = new Set(unit.costCenters.map((c) => c.code));
  const ccOptions = costCenters
    .filter((c) => ownCodes.has(c.code) || c.id === unit.income?.defaultCostCenterId)
    .map((c) => ({
      value: c.id,
      label: `${c.code} – ${c.name}`,
      short: c.code,
    }));

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
          ? t("deleteMessagePrefixes", { prefixes: unit.prefixes.map((p) => p.value).join(", ") })
          : t("deleteMessage"),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    // The endpoint refuses while owners or unattested expenses hang on it, and
    // says which, so no pre-check is needed here.
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

  // ── Sales ──
  //
  // Everything a unit needs in order to take money in. The key intakt groups
  // reports by is not among these: it is derived from the name when the
  // profile is created and never changed, and nobody here needs to read it.

  async function enableIncome() {
    await mutate("/api/income/units", {
      key: `income-new-${unit.id}`,
      // The verifikationstext starts as the unit's own name. It is what the
      // voucher will say, and that is a better start than blank.
      body: { resultUnitId: unit.id, description: unit.resultUnit },
      error: t("saveFailed"),
    });
  }

  async function updateIncome(body: Record<string, unknown>) {
    if (!unit.income) return;
    await mutate(`/api/income/units/${unit.income.id}`, {
      key: `income-${unit.income.id}`,
      method: "PATCH",
      body,
      error: t("saveFailed"),
    });
  }

  async function removeIncome() {
    if (!unit.income) return;
    const ok = await confirm({
      title: tIncome("removeTitle", { name: unit.resultUnit }),
      message: tIncome("removeBody"),
      confirmLabel: tIncome("remove"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/income/units/${unit.income.id}`, {
      key: `income-${unit.income.id}`,
      method: "DELETE",
      error: t("saveFailed"),
    });
  }

  async function addProductPrefix() {
    if (!unit.income || !productDraft) return;
    const ok = await mutate("/api/income/prefixes", {
      key: "addProduct",
      body: {
        incomeId: unit.income.id,
        code: productDraft.code.trim(),
        account: productDraft.account.trim(),
      },
      error: t("saveFailed"),
    });
    if (ok) setProductDraft(null);
  }

  // The API moves the flag off whichever prefix held it, so there is always at
  // most one fallback and no need to clear the old one here.
  async function makeFallback(id: string) {
    await mutate(`/api/income/prefixes/${id}`, {
      key: `fallback-${id}`,
      method: "PATCH",
      body: { isFallback: true },
      error: t("saveFailed"),
    });
  }

  async function removeProductPrefix(id: string) {
    await mutate(`/api/income/prefixes/${id}`, {
      key: `product-${id}`,
      method: "DELETE",
      error: t("saveFailed"),
    });
  }

  return (
    <Modal label={unit.resultUnit} onClose={onClose} className="max-w-2xl">
      {/* Not ModalHeader: the name is edited in place here, and the delete and
          the close sit beside it. */}
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-inset py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">
            <EditableText value={unit.resultUnit} label={t("renameAria", { name: unit.resultUnit })} onSave={rename} />
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
        {/* ── Which cost centres are its ── */}
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

          {/* The cost centres themselves, folded: the count is usually what is
              wanted, and the list is there for checking a particular code. */}
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

        {/* ── Who attests them ──
            Read-only here. Which groups make somebody resultatansvarig for a
            unit is set under Inställningar → Roller, and who is in a group is
            Authentik's. Showing the groups and not just the names is what makes
            an empty list diagnosable: nobody holds the post, or no group grants
            it. */}
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
            <Link href="/admin/roles" className="font-medium text-accent hover:underline">
              {t("editInRoles")}
            </Link>
          </p>
        </Section>

        {/* ── How its sales are booked ──
            Only when the income module is configured: a section that runs
            without intakt has no use for any of it, and the result-unit screen
            must not depend on income existing. */}
        {incomeEnabled && (
          <Section title={tIncome("section")} hint={tIncome("sectionHint")}>
            {!unit.income ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">{tIncome("disabledHint")}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending === `income-new-${unit.id}`}
                  onClick={enableIncome}
                >
                  <IconPlus className="size-4" />
                  {tIncome("enable")}
                </Button>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label={tIncome("description")} hint={tIncome("descriptionHint")}>
                    <Input
                      size="sm"
                      // Uncontrolled: it commits on blur rather than on every
                      // keystroke. The dialog is keyed on the unit, so opening
                      // another one re-reads the default.
                      defaultValue={unit.income.description}
                      aria-label={tIncome("description")}
                      onBlur={(e) =>
                        e.target.value !== unit.income?.description &&
                        updateIncome({ description: e.target.value })
                      }
                    />
                  </FieldGroup>
                  <FieldGroup label={tIncome("defaultCostCenter")} hint={tIncome("defaultCostCenterHint")}>
                    <Combobox
                      size="sm"
                      options={ccOptions}
                      value={unit.income.defaultCostCenterId ?? ""}
                      onChange={(v) => updateIncome({ defaultCostCenterId: v || null })}
                      placeholder={tIncome("noCostCenter")}
                      emptyText={tIncome("noOwnCostCenters")}
                      allowClear
                      aria-label={tIncome("defaultCostCenter")}
                    />
                  </FieldGroup>
                </div>

                {/* Which goods are this unit's: a small table of "starts with"
                    and the account it is booked to, the add row as its last
                    line. Chips with an arrow said the same thing, but not
                    what it meant. */}
                <FieldGroup label={tIncome("productPrefixes")} hint={tIncome("productHint")}>
                  <ul className="rounded-control border border-border">
                    {unit.income.prefixes.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-0"
                      >
                        <span className="w-20 shrink-0 font-mono text-sm font-semibold">{p.code}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          <span className="font-mono tabular-nums">{p.account}</span>
                          {p.accountName && <span className="text-muted"> – {p.accountName}</span>}
                        </span>
                        {/* An account the chart has never heard of is a
                            voucher Fortnox will reject, but only at export, so
                            it is worth saying here. */}
                        {!p.accountName && <Tag tone="warning">{tIncome("unknownAccount")}</Tag>}
                        {p.isFallback ? (
                          <span title={tIncome("fallbackHint")}>
                            <Tag tone="accent">{tIncome("fallback")}</Tag>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            title={tIncome("fallbackHint")}
                            loading={pending === `fallback-${p.id}`}
                            onClick={() => makeFallback(p.id)}
                          >
                            {tIncome("makeFallback")}
                          </Button>
                        )}
                        <IconButton
                          tone="danger"
                          size="xs"
                          disabled={p.isFallback}
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
                            setProductDraft({ account: productDraft?.account ?? "", code: e.target.value })
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
                            setProductDraft({ code: productDraft?.code ?? "", account: e.target.value })
                          }
                          onKeyDown={(e) => { if (e.key === "Enter") addProductPrefix(); }}
                          placeholder="3011"
                          aria-label={tIncome("prefixAccount")}
                          className="font-mono"
                        />
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending === "addProduct"}
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
                    loading={pending === `income-${unit.income.id}`}
                    onClick={removeIncome}
                  >
                    {tIncome("remove")}
                  </Button>
                </div>
              </>
            )}
          </Section>
        )}
      </ModalBody>
    </Modal>
  );
}

/** A titled part of the unit dialog, with a line saying what it decides. */
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

/** Cost centres by code, the retired ones after the rest and dimmed. */
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
