"use client";

// A stock's places (docs/stock.md, section 11): where stock is carried to, whose cost centre it is charged to, and
// which Authentik groups may log moves to and from it. Everything saves as it is picked, like the rest of the page.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Combobox, MultiCombobox, type ComboOption } from "@/components/ui/combobox";
import { EditableText } from "@/components/ui/editable-text";
import { Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconArchive, IconPlus, IconTrash, IconUndo } from "@/components/ui/icons";
import type { PatchStockPlace } from "@/lib/api/schemas/stock";
import type { StockPlaceSettings } from "@/lib/data/stock-settings";
import type { StockSlug } from "@/lib/stock/stocks";
import { cn } from "@/lib/ui/utils";

export function PlaceTable({
  stock,
  places,
  knownGroups,
  costCenterOptions,
}: {
  stock: StockSlug;
  places: StockPlaceSettings[];
  knownGroups: string[];
  costCenterOptions: ComboOption[];
}) {
  const t = useTranslations("admin.stock.places");
  const tStock = useTranslations("admin.stock");
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const [rows, setRows] = useState(places);
  const [name, setName] = useState("");

  // The list follows the server after a save (a new or archived place), adjusted during render.
  const [seen, setSeen] = useState(places);
  if (seen !== places) {
    setSeen(places);
    setRows(places);
  }

  async function patch(place: StockPlaceSettings, body: PatchStockPlace, key: string) {
    setRows((now) => now.map((p) => (p.id === place.id ? { ...p, ...body } : p)));
    return mutate(`/api/stock/places/${place.id}`, {
      key: `${place.id}.${key}`,
      method: "PATCH",
      body,
      error: tStock("saveFailed"),
      success: tStock("saved"),
    });
  }

  async function add() {
    const made = await mutate("/api/stock/places", {
      key: `${stock}.addPlace`,
      body: { stock, name: name.trim() },
      error: tStock("saveFailed"),
    });
    if (made !== null) setName("");
  }

  async function remove(place: StockPlaceSettings) {
    const ok = await confirm({
      title: t("removeTitle", { name: place.name }),
      message: t("removeMessage"),
      confirmLabel: t("remove"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/stock/places/${place.id}`, {
      key: `${place.id}.remove`,
      method: "DELETE",
      error: tStock("saveFailed"),
      success: t("removed", { name: place.name }),
    });
  }

  // Every group anybody holds, and the ones already chosen even if nobody holds them (a typo shows as held by none).
  const groupOptions = (chosen: string[]): ComboOption[] =>
    [...new Set([...knownGroups, ...chosen])].sort().map((g) => ({ value: g, label: g }));

  return (
    <div className="border-t border-border">
      <ul>
        {rows.map((place) => (
          <li
            key={place.id}
            className={cn("border-b border-border px-inset py-3", place.archived && "opacity-60")}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <EditableText
                  value={place.name}
                  label={t("name")}
                  maxLength={60}
                  disabled={place.archived}
                  onSave={async (next) =>
                    (await patch(place, { name: next.trim() }, "name")) !== null
                  }
                  className="text-sm font-medium"
                />
                <span className="shrink-0 text-xs text-muted">
                  {place.archived ? t("archived") : t("holders", { count: place.holders })}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* Deleted only while nothing names it. One in the log is archived, so the history keeps its name. */}
                {(place.movements > 0 || place.archived) && (
                  <IconButton
                    label={place.archived ? t("restore") : t("archive")}
                    title={place.archived ? t("restore") : t("archive")}
                    loading={pending === `${place.id}.archived`}
                    onClick={() => patch(place, { archived: !place.archived }, "archived")}
                  >
                    {place.archived ? (
                      <IconUndo className="size-4" />
                    ) : (
                      <IconArchive className="size-4" />
                    )}
                  </IconButton>
                )}
                {place.movements === 0 && (
                  <IconButton
                    label={t("remove")}
                    title={t("remove")}
                    loading={pending === `${place.id}.remove`}
                    onClick={() => remove(place)}
                  >
                    <IconTrash className="size-4" />
                  </IconButton>
                )}
              </div>
            </div>
            {!place.archived && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs text-muted">{t("costCenter")}</span>
                  <Combobox
                    size="sm"
                    options={costCenterOptions}
                    value={place.costCenterId ?? ""}
                    onChange={(v) => patch(place, { costCenterId: v || null }, "costCenterId")}
                    // Until one is chosen the stock's own consumption cost centre is charged, and it says so.
                    placeholder={t("costCenterFallback")}
                    allowClear
                    aria-label={`${place.name}: ${t("costCenter")}`}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs text-muted">{t("groups")}</span>
                  <MultiCombobox
                    size="sm"
                    options={groupOptions(place.groups)}
                    values={place.groups}
                    onChange={(groups) => patch(place, { groups }, "groups")}
                    onCreate={(text) =>
                      patch(
                        place,
                        { groups: [...place.groups, text.trim().toLowerCase()] },
                        "groups",
                      )
                    }
                    createLabel={(text) => t("useGroup", { group: text.trim().toLowerCase() })}
                    placeholder={t("noGroups")}
                    searchPlaceholder={t("searchGroups")}
                    aria-label={`${place.name}: ${t("groups")}`}
                  />
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 px-inset py-3">
        <Input
          size="sm"
          className="min-w-0 max-w-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) add();
          }}
          placeholder={t("newPlaceholder")}
          aria-label={t("newPlaceholder")}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={name.trim() === ""}
          loading={pending === `${stock}.addPlace`}
          onClick={add}
        >
          <IconPlus className="size-4" />
          {t("add")}
        </Button>
      </div>
    </div>
  );
}
