"use client";

// Settings → Result units. A result unit owns one or more cost-centre code
// prefixes; every cost centre whose code starts with one of them belongs to it,
// and its resultatansvariga hold approval authority over those expenses.
//
// Laid out as a master–detail pair: a searchable result unit list on the left,
// the selected result unit on the right. Cost centres with no result unit at
// all are the last entry in that list rather than a section of their own, so a
// long tail of unclaimed codes stays out of the way until it's asked for.
import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyNote } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldGroup, Input } from "@/components/ui/field";
import { Tag } from "@/components/ui/status-pill";
import { SidebarItem, SidebarPanel } from "@/components/ui/sidebar-list";
import { IconPencil, IconPlus, IconTrash } from "@/components/ui/icons";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { cn } from "@/lib/ui/utils";
import type { CostCenter, ResultUnit, ResultUnitCostCenter } from "@/lib/domain/types";

// Sentinel for the "no result unit" entry in the left-hand list.
const UNASSIGNED = "__unassigned__";

export function ResultUnitsClient({
  resultUnits,
  unassigned,
  costCenters,
  incomeEnabled,
}: {
  resultUnits: ResultUnit[];
  unassigned: ResultUnitCostCenter[];
  /**
   * Result unit names the Authentik mapping grants that no result unit here is
   * called. Each one is a group conferring nothing — see getUnmappedResultUnits.
   */
  /** For the income section's default-cost-centre picker. */
  costCenters: CostCenter[];
  /** False when the app runs without the intakt service — see intaktConfigured. */
  incomeEnabled: boolean;
}) {
  const t = useTranslations("admin.resultUnits");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("common.role");
  const tNav = useTranslations("nav");
  const tAlloc = useTranslations("allocation");
  const tCostCenters = useTranslations("admin.costCenters");
  const tIncome = useTranslations("admin.resultUnits.income");
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();

  const [selectedId, setSelectedId] = useState<string>(
    () => resultUnits[0]?.id ?? UNASSIGNED,
  );
  const [search, setSearch] = useState("");
  const [ccSearch, setCcSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [addingResultUnit, setAddingResultUnit] = useState(false);
  // The prefix input is hidden behind a + until asked for, so the row of
  // prefixes reads as data rather than as a form. The name works the same way,
  // behind the pencil: null means "not editing".
  const [prefixDraft, setPrefixDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // The product-prefix form, same idea: two fields behind a +.
  const [productDraft, setProductDraft] = useState<{ code: string; account: string } | null>(null);

  const ccOptions = costCenters.map((c) => ({
    value: c.id,
    label: `${c.code} — ${c.name}`,
    short: c.code,
  }));

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? resultUnits.filter(
            (c) =>
              c.resultUnit.toLowerCase().includes(q) ||
              c.prefixes.some((p) => p.value.toLowerCase().includes(q)) ||
              c.costCenters.some(
                (cc) =>
                  cc.code.toLowerCase().includes(q) || cc.name.toLowerCase().includes(q),
              ),
          )
        : resultUnits,
    [resultUnits, q],
  );

  const selected =
    selectedId === UNASSIGNED ? null : resultUnits.find((c) => c.id === selectedId) ?? null;
  const showingUnassigned = selectedId === UNASSIGNED;

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
    setAddingResultUnit(false);
    if (typeof created.id === "string") setSelectedId(created.id);
  }

  async function removeResultUnit(c: ResultUnit) {
    const confirmed = await confirm({
      title: t("deleteTitle", { name: c.resultUnit }),
      message:
        c.prefixes.length > 0
          ? t("deleteMessagePrefixes", { prefixes: c.prefixes.map((p) => p.value).join(", ") })
          : t("deleteMessage"),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    // The endpoint refuses while owners or unattested expenses hang on it, and
    // says which — so no pre-check is needed here.
    const ok = await mutate(`/api/result-units/${c.id}`, {
      key: c.id,
      method: "DELETE",
      error: t("deleteFailed"),
      success: t("deleted", { name: c.resultUnit }),
    });
    if (ok) setSelectedId(resultUnits.find((x) => x.id !== c.id)?.id ?? UNASSIGNED);
  }

  async function rename(c: ResultUnit) {
    const name = (nameDraft ?? "").trim();
    if (!name || name === c.resultUnit) {
      setNameDraft(null);
      return;
    }
    const ok = await mutate(`/api/result-units/${c.id}`, {
      key: `name-${c.id}`,
      method: "PATCH",
      body: { name },
      error: t("renameFailed"),
      success: t("renamed", { name }),
    });
    if (ok) setNameDraft(null);
  }

  async function addPrefix(c: ResultUnit) {
    const value = (prefixDraft ?? "").trim();
    if (!value) return;
    const ok = await mutate(`/api/result-units/${c.id}/prefixes`, {
      key: `prefix-${c.id}`,
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

  // ── The income half ───────────────────────────────────────────────
  //
  // Everything a verksamhet needs in order to take money in, edited here
  // because this is where the verksamhet is. The key is not among these: it is
  // derived from the name when the profile is created and never changed.

  async function enableIncome(c: ResultUnit) {
    await mutate("/api/income/units", {
      key: `income-new-${c.id}`,
      // The verifikationstext starts as the unit's own name — it is what the
      // voucher will say, and that is a better start than blank.
      body: { resultUnitId: c.id, description: c.resultUnit },
      error: t("saveFailed"),
    });
  }

  async function updateIncome(c: ResultUnit, body: Record<string, unknown>) {
    if (!c.income) return;
    await mutate(`/api/income/units/${c.income.id}`, {
      key: `income-${c.income.id}`,
      method: "PATCH",
      body,
      error: t("saveFailed"),
    });
  }

  async function removeIncome(c: ResultUnit) {
    if (!c.income) return;
    const ok = await confirm({
      title: tIncome("removeTitle", { name: c.resultUnit }),
      message: tIncome("removeBody"),
      confirmLabel: tIncome("remove"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/income/units/${c.income.id}`, {
      key: `income-${c.income.id}`,
      method: "DELETE",
      error: t("saveFailed"),
    });
  }

  async function addProductPrefix(c: ResultUnit) {
    if (!c.income || !productDraft) return;
    const ok = await mutate("/api/income/prefixes", {
      key: "addProduct",
      body: {
        incomeId: c.income.id,
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

  function costCentreGroups(list: ResultUnitCostCenter[]) {
    const needle = ccSearch.trim().toLowerCase();
    const filtered = needle
      ? list.filter(
          (cc) =>
            cc.code.toLowerCase().includes(needle) || cc.name.toLowerCase().includes(needle),
        )
      : list;
    return {
      active: filtered.filter((cc) => cc.active),
      inactive: filtered.filter((cc) => !cc.active),
      total: filtered.length,
    };
  }

  // A card of its own rather than a bordered box inside the result unit card —
  // the rows run edge to edge, which is how every other list in the app reads.
  function costCentreCard(
    list: ResultUnitCostCenter[],
    { subtitle, emptyText }: { subtitle: string; emptyText: string },
  ) {
    const groups = costCentreGroups(list);
    return (
      <Card>
        <CardHeader
          title={tNav("costCenters")}
          subtitle={subtitle}
          action={
            list.length > 0 ? (
              <div className="w-56">
                <Input
                  size="sm"
                  value={ccSearch}
                  onChange={(e) => setCcSearch(e.target.value)}
                  placeholder={tAlloc("search")}
                />
              </div>
            ) : undefined
          }
        />

        {list.length === 0 ? (
          <EmptyNote>{emptyText}</EmptyNote>
        ) : groups.total === 0 ? (
          <EmptyNote>{t("noCostCentersMatch")}</EmptyNote>
        ) : (
          (
            [
              [t("active"), groups.active, true],
              [t("inactive"), groups.inactive, false],
            ] as const
          ).map(([label, rows, isActive]) =>
            rows.length === 0 ? null : (
              <div key={label}>
                <p className="border-b border-border bg-surface/60 px-inset py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {label} ({rows.length})
                </p>
                <ul>
                  {rows.map((cc) => (
                    <li
                      key={cc.code}
                      className={cn(
                        "flex items-center gap-4 border-b border-border px-inset py-2.5 last:border-0",
                        !isActive && "opacity-55",
                      )}
                    >
                      <span className="w-20 shrink-0 font-mono text-xs font-semibold">
                        {cc.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{cc.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )
        )}
      </Card>
    );
  }

  const unassignedActive = unassigned.filter((cc) => cc.active).length;

  return (
    <div className="space-y-4">

      <div className="flex flex-col gap-4 lg:flex-row">
      <SidebarPanel>
        <div className="border-b border-border p-3">
          <Input
            size="sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        </div>

        <div className="max-h-[52vh] overflow-y-auto">
          {visible.length === 0 ? (
            <EmptyNote size="compact">
              {resultUnits.length === 0 ? t("emptyNone") : t("emptyNoMatch")}
            </EmptyNote>
          ) : (
            <ul>
              {visible.map((c) => (
                <li key={c.id}>
                  <SidebarItem
                    active={selectedId === c.id}
                    className="border-b border-border last:border-0"
                    onClick={() => {
                      setSelectedId(c.id);
                      setCcSearch("");
                      setPrefixDraft(null);
                      setNameDraft(null);
                      // Same reason as the other two drafts, and it matters
                      // more: a product-prefix form left open across a switch
                      // would post what was typed for one verksamhet to
                      // whichever one is selected when Lägg till is pressed.
                      setProductDraft(null);
                    }}
                  >
                    <span className="block truncate text-sm font-medium">{c.resultUnit}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {c.prefixes.length
                        ? c.prefixes.map((p) => p.value).join(", ")
                        : t("noPrefix")}
                      {" · "}
                      {t("costCenterCount", { count: c.costCenterCount })}
                    </span>
                  </SidebarItem>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* No-resultUnit entry — a selection, not a wall of tags. */}
        <SidebarItem
          active={showingUnassigned}
          className="border-t border-border"
          onClick={() => {
            setSelectedId(UNASSIGNED);
            setCcSearch("");
          }}
        >
          <span className="block truncate text-sm font-medium">{t("unassigned")}</span>
          <span className="mt-0.5 block text-xs text-muted">
            {t("activeCostCenters", { count: unassignedActive })}
          </span>
        </SidebarItem>

        <div className="border-t border-border p-3">
          {addingResultUnit ? (
            <div className="flex items-center gap-2">
              <Input
                size="sm"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pending !== "new-resultUnit") createResultUnit();
                  if (e.key === "Escape") {
                    setAddingResultUnit(false);
                    setNewName("");
                  }
                }}
                placeholder={t("namePlaceholder")}
                className="min-w-0 flex-1"
              />
              <Button
                size="sm"
                loading={pending === "new-resultUnit"}
                disabled={!newName.trim()}
                onClick={createResultUnit}
              >
                {t("create")}
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => setAddingResultUnit(true)}
            >
              <IconPlus className="size-4" />
              {t("new")}
            </Button>
          )}
        </div>
      </SidebarPanel>

      <div className="min-w-0 flex-1">
        {showingUnassigned ? (
          costCentreCard(unassigned, {
            subtitle: t("unassignedSubtitle"),
            emptyText: t("unassignedEmpty"),
          })
        ) : !selected ? (
          <Card>
            <CardBody>
              <EmptyNote size="page">{t("pickResultUnit")}</EmptyNote>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-5">
            <Card>
              <div className="flex items-start justify-between gap-4 border-b border-border px-inset py-4">
                <div className="min-w-0 flex-1">
                  {/* Editing starts on the pencil, never by clicking the title —
                      an input that merely looks like a heading gives no hint that
                      it can be changed, and invites accidental edits. */}
                  {nameDraft === null ? (
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-base font-semibold">{selected.resultUnit}</h2>
                      <IconButton
                        size="sm"
                        label={t("renameAria", { name: selected.resultUnit })}
                        onClick={() => setNameDraft(selected.resultUnit)}
                      >
                        <IconPencil className="size-4" />
                      </IconButton>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        size="sm"
                        autoFocus
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") rename(selected);
                          if (e.key === "Escape") setNameDraft(null);
                        }}
                        aria-label={t("namePlaceholder")}
                        className="min-w-0 flex-1 font-semibold"
                      />
                      <Button
                        size="sm"
                        loading={pending === `name-${selected.id}`}
                        disabled={!nameDraft.trim()}
                        onClick={() => rename(selected)}
                      >
                        {tCostCenters("save")}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setNameDraft(null)}>
                        {tCommon("cancel")}
                      </Button>
                    </div>
                  )}
                  <p className="mt-0.5 text-sm text-muted">
                    {t("activeCostCenters", { count: selected.costCenterCount })}
                  </p>
                </div>
                <IconButton
                  tone="danger"
                  onClick={() => removeResultUnit(selected)}
                  loading={pending === selected.id}
                  label={t("deleteAria", { name: selected.resultUnit })}
                >
                  <IconTrash className="size-4" />
                </IconButton>
              </div>

              <CardBody className="space-y-5">
                {/* Cost-centre prefixes — which cost centres are the unit's. */}
                <div>
                  <p className="mb-2 text-xs font-medium text-muted">{t("prefixes")}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {selected.prefixes.map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-3 pr-1.5 font-mono text-xs font-semibold"
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
                      <button
                        onClick={() => setPrefixDraft("")}
                        title={t("prefixAdd")}
                        aria-label={t("prefixAdd")}
                        className="inline-flex size-7 items-center justify-center rounded-full border border-dashed border-border text-muted transition hover:border-accent hover:text-accent"
                      >
                        <IconPlus className="size-4" />
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-24">
                          <Input
                            size="sm"
                            autoFocus
                            value={prefixDraft}
                            onChange={(e) => setPrefixDraft(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && pending !== `prefix-${selected.id}`) {
                                addPrefix(selected);
                              }
                              if (e.key === "Escape") setPrefixDraft(null);
                            }}
                            placeholder="SKT"
                            aria-label={t("prefixNew")}
                            className="font-mono uppercase"
                          />
                        </span>
                        <Button
                          size="sm"
                          loading={pending === `prefix-${selected.id}`}
                          disabled={!prefixDraft.trim()}
                          onClick={() => addPrefix(selected)}
                        >
                          {tCostCenters("add")}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setPrefixDraft(null)}>
                          {tCommon("cancel")}
                        </Button>
                      </span>
                    )}

                    {selected.prefixes.length === 0 && prefixDraft === null && (
                      <span className="text-sm text-muted">{t("noPrefixHint")}</span>
                    )}
                  </div>
                </div>

                {/* Product prefixes and the rest of the income half. Rendered
                    only when the income module is configured: a section that
                    runs without intakt has no use for any of it, and the
                    result-unit screen must not depend on income existing. */}
                {incomeEnabled && (
                  <div className="space-y-4 rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs font-medium text-muted">{tIncome("section")}</p>
                      {selected.income ? (
                        <span className="flex items-center gap-2 text-xs text-muted">
                          {/* Derived from the name and never edited — shown so
                              it can be recognised in intakt's own output. */}
                          <span className="font-mono">{selected.income.key}</span>
                          <IconButton
                            tone="danger"
                            size="xs"
                            label={tIncome("remove")}
                            loading={pending === `income-${selected.income.id}`}
                            onClick={() => removeIncome(selected)}
                          >
                            <IconTrash className="size-3.5" />
                          </IconButton>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={pending === `income-new-${selected.id}`}
                          onClick={() => enableIncome(selected)}
                        >
                          <IconPlus className="size-4" />
                          {tIncome("enable")}
                        </Button>
                      )}
                    </div>

                    {selected.income ? (
                      <>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label={tIncome("description")} hint={tIncome("descriptionHint")}>
                            <Input
                              size="sm"
                              // Uncontrolled, because it commits on blur rather
                              // than on every keystroke — so `defaultValue` is
                              // read once, when the input mounts. Selecting
                              // another verksamhet does not remount it: it is
                              // the same element in the same place, and React
                              // keeps it (and its typed-in value) while only
                              // the props change. The field went on showing the
                              // first unit's verifikationstext however many
                              // units you clicked through. Keying it on the
                              // income profile makes switching a remount, which
                              // is what re-reads the default.
                              key={selected.income.id}
                              defaultValue={selected.income.description}
                              onBlur={(e) =>
                                e.target.value !== selected.income?.description &&
                                updateIncome(selected, { description: e.target.value })
                              }
                            />
                          </Field>
                          <FieldGroup label={tIncome("defaultCostCenter")}>
                            <Combobox
                              options={ccOptions}
                              value={selected.income.defaultCostCenterId ?? ""}
                              onChange={(v) => updateIncome(selected, { defaultCostCenterId: v || null })}
                              placeholder={tIncome("noCostCenter")}
                              allowClear
                              aria-label={tIncome("defaultCostCenter")}
                            />
                          </FieldGroup>
                        </div>

                        <div>
                          <p className="mb-2 text-xs font-medium text-muted">
                            {tIncome("productPrefixes")}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            {selected.income.prefixes.map((p) => (
                              <span
                                key={p.id}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-3 pr-1.5 text-xs"
                              >
                                <span className="font-mono font-semibold">{p.code}</span>
                                <span className="text-muted">→ {p.account}</span>
                                {/* An account the chart has never heard of is a
                                    voucher Fortnox will reject, but only at
                                    export — so it is worth saying here. */}
                                {!p.accountName && (
                                  <Tag tone="warning">{tIncome("unknownAccount")}</Tag>
                                )}
                                {p.isFallback && <Tag tone="accent">{tIncome("fallback")}</Tag>}
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
                              </span>
                            ))}

                            {productDraft === null ? (
                              <button
                                onClick={() => setProductDraft({ code: "", account: "" })}
                                title={tIncome("prefixAdd")}
                                aria-label={tIncome("prefixAdd")}
                                className="inline-flex size-7 items-center justify-center rounded-full border border-dashed border-border text-muted transition hover:border-accent hover:text-accent"
                              >
                                <IconPlus className="size-4" />
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="w-20">
                                  <Input
                                    size="sm"
                                    autoFocus
                                    value={productDraft.code}
                                    onChange={(e) =>
                                      setProductDraft({ ...productDraft, code: e.target.value })
                                    }
                                    placeholder="s1"
                                    aria-label={tIncome("prefixCode")}
                                    className="font-mono"
                                  />
                                </span>
                                <span className="w-24">
                                  <Input
                                    size="sm"
                                    inputMode="numeric"
                                    value={productDraft.account}
                                    onChange={(e) =>
                                      setProductDraft({ ...productDraft, account: e.target.value })
                                    }
                                    placeholder="3011"
                                    aria-label={tIncome("prefixAccount")}
                                    className="font-mono"
                                  />
                                </span>
                                <Button
                                  size="sm"
                                  loading={pending === "addProduct"}
                                  disabled={!productDraft.code.trim() || !productDraft.account.trim()}
                                  onClick={() => addProductPrefix(selected)}
                                >
                                  {tCostCenters("add")}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setProductDraft(null)}
                                >
                                  {tCommon("cancel")}
                                </Button>
                              </span>
                            )}

                            {selected.income.prefixes.length === 0 && productDraft === null && (
                              <span className="text-sm text-muted">{tIncome("noPrefixHint")}</span>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted">{tIncome("disabledHint")}</p>
                    )}
                  </div>
                )}

                {/* Resultatansvariga — read-only: both halves come from
                    Authentik. The groups are the mapping in
                    lib/server/authentik-roles.ts, the holders are whoever is in
                    them. Showing the groups and not just the names is what makes
                    an empty list diagnosable: nobody holds the post, or the
                    mapping points at a group that does not exist. */}
                <div>
                  <p className="mb-2 text-xs font-medium text-muted">{tRole("RESULTATANSVARIG")}</p>
                  {selected.ownerGroups.length === 0 ? (
                    <p className="text-sm text-muted">{t("noOwnerGroups")}</p>
                  ) : (
                    <>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {selected.ownerGroups.map((g) => (
                          <code
                            key={g}
                            className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted"
                          >
                            {g}
                          </code>
                        ))}
                      </div>
                      {selected.owners.length === 0 ? (
                        <p className="text-sm text-muted">{t("noOwnersHolding")}</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {selected.owners.map((u) => (
                            <span
                              key={u.id}
                              className="h-7 rounded-full border border-accent bg-accent-soft px-3 text-xs font-medium leading-7 text-accent"
                            >
                              {u.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

              </CardBody>
            </Card>

            {costCentreCard(selected.costCenters, {
              subtitle: t("matchedBy", {
                prefixes: selected.prefixes.length
                  ? selected.prefixes.map((p) => p.value).join(", ")
                  : t("noPrefixLower"),
              }),
              emptyText: t("noCostCentersForPrefix"),
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
