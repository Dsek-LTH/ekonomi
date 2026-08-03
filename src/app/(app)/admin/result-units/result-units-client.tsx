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
import { Chip } from "@/components/ui/chip";
import { EmptyNote } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/field";
import { SidebarItem, SidebarPanel } from "@/components/ui/sidebar-list";
import { IconPencil, IconPlus, IconTrash } from "@/components/ui/icons";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { cn } from "@/lib/ui/utils";
import type { ResultUnit, ResultUnitCostCenter, User } from "@/lib/domain/types";

// Sentinel for the "no result unit" entry in the left-hand list.
const UNASSIGNED = "__unassigned__";

export function ResultUnitsClient({
  resultUnits,
  users,
  unassigned,
}: {
  resultUnits: ResultUnit[];
  users: User[];
  unassigned: ResultUnitCostCenter[];
}) {
  const t = useTranslations("admin.resultUnits");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("common.role");
  const tNav = useTranslations("nav");
  const tAlloc = useTranslations("allocation");
  const tCostCenters = useTranslations("admin.costCenters");
  const confirm = useConfirm();
  const { pending, busy, mutate } = useMutation();

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

  const ownerCandidates = users.filter((u) => u.roles.includes("RESULTATANSVARIG"));

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

  function toggleOwner(c: ResultUnit, userId: string) {
    const ids = c.owners.map((m) => m.id);
    const next = ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId];
    mutate(`/api/result-units/${c.id}/owners`, {
      // Keyed per owner, not per result unit: every chip in the row goes
      // through here, and a shared key would spin all of them at once.
      key: `owner-${c.id}-${userId}`,
      method: "PUT",
      body: { userIds: next },
      error: t("ownersFailed"),
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
                {/* Prefixes */}
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

                {/* Owners */}
                <div>
                  <p className="mb-2 text-xs font-medium text-muted">{tRole("RESULTATANSVARIG")}</p>
                  {ownerCandidates.length === 0 ? (
                    <p className="text-sm text-muted">{t("noOwners")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {ownerCandidates.map((u) => (
                        <Chip
                          key={u.id}
                          active={selected.owners.some((m) => m.id === u.id)}
                          loading={pending === `owner-${selected.id}-${u.id}`}
                          disabled={busy}
                          onClick={() => toggleOwner(selected, u.id)}
                        >
                          {u.name}
                        </Chip>
                      ))}
                    </div>
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
  );
}
