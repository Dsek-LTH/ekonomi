"use client";

// Settings → Cost centers. One list. The Fortnox-owned ones are mirrored here
// by the sync (which runs from Settings → Fortnox, with everything else fetched
// from there) and are read-only, since the next sync would overwrite anything
// changed here. The local ones are this app's own and fully editable. Which is
// which is a mark on the code, not a column and a tab: it decides what you can
// do to a row, not what kind of thing the row is.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Column } from "@/components/ui/data-table";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import { FieldGroup, Input } from "@/components/ui/field";
import { IconDots, IconLock, IconPencil, IconPlus, IconTrash } from "@/components/ui/icons";
import { Menu, MenuItem } from "@/components/ui/menu";
import { IconFortnox } from "@/components/shell/fortnox-mark";
import { Tag } from "@/components/ui/status-pill";
import { useTableControls } from "@/lib/data/use-list-query";
import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { cn } from "@/lib/ui/utils";
import { SHORT_NAME_MAX, suggestShortName } from "@/lib/domain/cost-center-short-name";
import type { CostCenter } from "@/lib/domain/types";
import { ShortNamesDialog, type Suggestion } from "./short-names-dialog";

// Retired cost centres stay in the list. Seeing that SEX02 exists but is
// inactive is what explains why it isn't in the picker, but the default filter
// is the active ones, since that is the list anyone is normally looking for.
export function CostCentersClient({ costCenters }: { costCenters: CostCenter[] }) {
  const t = useTranslations("admin.costCenters");
  const tCommon = useTranslations("common");
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const controls = useTableControls();

  const tabs: ClientTabFilter<CostCenter> = [
    { value: "active", label: t("tab.active"), predicate: (c) => c.active },
    { value: "inactive", label: t("tab.inactive"), predicate: (c) => !c.active },
    { value: "all", label: t("tab.all") },
  ];

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ code: "", name: "" });
  // The row being renamed, and the name being typed for it.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // The row whose short name is being typed. Any row, Fortnox ones included:
  // the short name is this app's own, so the next sync leaves it alone.
  const [shortening, setShortening] = useState<{ id: string; name: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  // What the rule would set, for the cost centres with no short name yet. Only
  // ever offered, see ShortNamesDialog. A section whose names do not start with
  // their unit's gets none, and never sees the button.
  const suggestions = useMemo<Suggestion[]>(
    () =>
      costCenters.flatMap((cc) => {
        if (cc.shortName) return [];
        const shortName = suggestShortName(cc.name, cc.resultUnit);
        return shortName ? [{ cc, shortName }] : [];
      }),
    [costCenters],
  );

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

  async function saveShortName(cc: CostCenter) {
    if (!shortening) return;
    const shortName = shortening.name.trim() || null;
    const data = await mutate("/api/cost-centers/short-names", {
      key: `short-${cc.id}`,
      method: "PUT",
      body: { names: [{ id: cc.id, shortName }] },
      error: t("shortNameFailed"),
      success: shortName
        ? t("shortNameSaved", { code: cc.code, name: shortName })
        : t("shortNameCleared", { code: cc.code }),
    });
    if (data) setShortening(null);
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
    const data = await mutate<{ retired: boolean }>(`/api/cost-centers/${cc.id}`, {
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
      // The Fortnox mark says where it comes from, and so that it is not
      // changed here. No mark is the local ones: the exception gets the badge
      // only when it is the rule, and here Fortnox is the rule's source.
      cell: (c) => (
        <span className="inline-flex items-center gap-2">
          <Tag className="font-mono font-semibold">{c.code}</Tag>
          {c.source === "FORTNOX" && (
            <span title={t("fortnoxHint")} className="inline-flex">
              <IconFortnox className="size-4" />
              <span className="sr-only">Fortnox</span>
            </span>
          )}
        </span>
      ),
    },
    {
      key: "name",
      mobile: "meta",
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
      key: "shortName",
      mobile: "meta",
      header: <span title={t("shortNameHint")}>{t("colShortName")}</span>,
      value: (c) => c.shortName ?? "",
      sortable: true,
      searchable: true,
      cell: (c) =>
        shortening?.id === c.id ? (
          // Saved on Enter, as the rename above. Emptied and saved, it goes
          // back to the full name.
          <div className="flex flex-wrap items-center justify-end gap-2 md:justify-start">
            <Input
              size="sm"
              autoFocus
              value={shortening.name}
              maxLength={SHORT_NAME_MAX}
              onChange={(e) => setShortening({ id: c.id, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveShortName(c);
                if (e.key === "Escape") setShortening(null);
              }}
              aria-label={t("editShortName", { code: c.code })}
              className="min-w-32 flex-1 text-left"
            />
            <Button size="sm" loading={pending === `short-${c.id}`} onClick={() => saveShortName(c)}>
              {t("save")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShortening(null)}>
              {tCommon("cancel")}
            </Button>
          </div>
        ) : (
          // The value itself is the way in, on every row: there is no menu
          // on a Fortnox row to put "Ändra kortnamn" in.
          <button
            type="button"
            onClick={() => setShortening({ id: c.id, name: c.shortName ?? "" })}
            aria-label={t("editShortName", { code: c.code })}
            className="group/short inline-flex max-w-full items-center gap-1.5 rounded-control text-left hover:underline"
          >
            <span className={cn("truncate", !c.shortName && "text-faint")}>
              {c.shortName ?? t("shortNameNone")}
            </span>
            <IconPencil
              aria-hidden
              className="size-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover/short:opacity-100"
            />
          </button>
        ),
    },
    {
      key: "resultUnit",
      mobile: "meta",
      mobileCell: (c) => c.resultUnit ?? t("noResultUnit"),
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
      key: "status",
      header: t("colStatus"),
      value: (c) => (c.active ? 1 : 0),
      sortable: true,
      mobile: "status",
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
      className: "w-14",
      // Only the local ones are ours to change. A Fortnox row edited here would
      // just come back as it was on the next sync, so it gets a lock saying
      // where it is changed instead of buttons that would not stick. One menu
      // rather than three buttons: three on some rows and none on the rest
      // made the local ones look like a different table.
      cell: (c) =>
        c.source === "LOCAL" ? (
          <Menu
            label={t("rowActions", { code: c.code })}
            iconOnly
            variant="ghost"
            size="sm"
            loading={pending === `active-${c.id}` || pending === `delete-${c.id}`}
            icon={<IconDots className="size-4" />}
          >
            <MenuItem onClick={() => setRenaming({ id: c.id, name: c.name })}>
              <IconPencil className="size-4 shrink-0 text-muted" />
              {t("rename")}
            </MenuItem>
            <MenuItem onClick={() => setActive(c, !c.active)}>
              <IconLock className="size-4 shrink-0 text-muted" />
              {t(c.active ? "deactivate" : "activate")}
            </MenuItem>
            <MenuItem onClick={() => remove(c)} className="text-danger hover:bg-danger-soft">
              <IconTrash className="size-4 shrink-0" />
              {t("delete")}
            </MenuItem>
          </Menu>
        ) : (
          <span
            title={t("fortnoxHint")}
            className="inline-flex size-8 items-center justify-center text-faint"
          >
            <IconLock className="size-4" />
            <span className="sr-only">{t("fortnoxHint")}</span>
          </span>
        ),
    },
  ];

  return (
    <Card>
      {suggesting && <ShortNamesDialog suggestions={suggestions} onClose={() => setSuggesting(false)} />}
      <ClientDataTable
        columns={columns}
        rows={costCenters}
        controls={controls}
        tabs={tabs}
        // The form for a new one opens under the toolbar, just below the
        // button that asked for it and above the rows it will join.
        actionPanel={
          adding && (
            <FieldGroup label={t("codeAndName")} hint={t("newLocalSubtitle")} requirement="required">
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
          )
        }
        // On the list's own toolbar, like every other list's create button.
        // There is no card header: what the Fortnox mark means is in the page
        // description, and a header holding only this button was a row spent
        // on nothing.
        // The suggestions only when there are any: for a section whose names
        // do not follow the pattern, the button would only ever say "none".
        action={
          !adding && (
            <div className="flex flex-wrap items-center gap-2">
              {suggestions.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setSuggesting(true)}>
                  {t("suggest")}
                  <span className="tabular-nums text-muted">{suggestions.length}</span>
                </Button>
              )}
              <Button size="sm" onClick={() => setAdding(true)}>
                <IconPlus className="size-4" />
                {t("newLocal")}
              </Button>
            </div>
          )
        }
        searchPlaceholder={t("searchPlaceholder")}
        rowKey={(c) => c.id}
        rowClassName={(c) => cn(!c.active && "opacity-55")}
        empty={
          costCenters.length === 0 ? t("emptyNone") : t("emptyNoMatch")
        }
      />
    </Card>
  );
}
