"use client";

// Short names for the cost centres that have none: suggested by taking the result unit's name off the front, reviewed
// and saved together. A page in the overlay, reached from Kostnadsställen (docs/settings.md).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/field";
import { IconAlert } from "@/components/ui/icons";
import { PageShell } from "@/components/page-shell";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsForm, useDraftPart } from "@/components/settings/settings-draft";
import { useGoBack } from "@/components/shell/route-history";
import { useMutation } from "@/components/shell/use-mutation";
import { SHORT_NAME_MAX } from "@/lib/domain/cost-center-short-name";
import type { CostCenter } from "@/lib/domain/types";

export interface Suggestion {
  cc: CostCenter;
  shortName: string;
}

export function ShortNamesClient({ suggestions }: { suggestions: Suggestion[] }) {
  const t = useTranslations("admin.costCenters");
  return (
    <PageShell title={t("suggest")} back="/admin/cost-centers">
      <SettingsForm>
        <ShortNames suggestions={suggestions} />
      </SettingsForm>
    </PageShell>
  );
}

// The ticked suggestions are the page's unsaved change, saved with its Spara (docs/settings.md).
function ShortNames({ suggestions }: { suggestions: Suggestion[] }) {
  const t = useTranslations("admin.costCenters");
  const { mutate } = useMutation();
  const back = useGoBack("/admin/cost-centers");
  const [rows, setRows] = useState(() =>
    Object.fromEntries(suggestions.map((s) => [s.cc.id, { on: true, name: s.shortName }])),
  );

  const picked = suggestions.filter((s) => rows[s.cc.id].on);
  const allOn = picked.length === suggestions.length;
  const blocker =
    picked.length === 0 || picked.some((s) => !rows[s.cc.id].name.trim())
      ? t("suggestBlocked")
      : null;

  const set = (id: string, patch: Partial<{ on: boolean; name: string }>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  useDraftPart({
    dirty: picked.length > 0,
    save: async () => {
      if (blocker) return false;
      const data = await mutate("/api/cost-centers/short-names", {
        method: "PUT",
        body: {
          names: picked.map((s) => ({ id: s.cc.id, shortName: rows[s.cc.id].name.trim() })),
        },
        error: t("suggestFailed"),
        refresh: false,
      });
      return data !== null;
    },
    // Saved: these have short names now, so the list is done with.
    commit: () => back.goBack(),
    reset: () =>
      setRows(
        Object.fromEntries(suggestions.map((s) => [s.cc.id, { on: false, name: s.shortName }])),
      ),
  });

  return (
    <>
      {blocker && suggestions.length > 0 && (
        <p role="status" className="mb-3 flex items-start gap-2 text-xs text-warning">
          <IconAlert className="mt-px size-3.5 shrink-0" />
          {blocker}
        </p>
      )}
      <SettingsCard>
        {suggestions.length === 0 ? (
          <p className="px-inset py-6 text-center text-sm text-muted">{t("suggestNone")}</p>
        ) : (
          <div className="divide-y divide-border">
            <div className="flex items-center gap-3 bg-surface px-inset py-2">
              <Checkbox
                checked={allOn}
                indeterminate={!allOn && picked.length > 0}
                onChange={() => {
                  const on = !allOn;
                  setRows((r) =>
                    Object.fromEntries(Object.entries(r).map(([id, v]) => [id, { ...v, on }])),
                  );
                }}
                label={t("suggestAll")}
              >
                <span className="text-sm font-medium">{t("suggestAll")}</span>
              </Checkbox>
            </div>
            {suggestions.map(({ cc }) => {
              const row = rows[cc.id];
              return (
                <div key={cc.id} className="flex items-start gap-3 px-inset py-2.5">
                  <Checkbox
                    checked={row.on}
                    onChange={() => set(cc.id, { on: !row.on })}
                    label={t("suggestInclude", { code: cc.code })}
                    className="mt-1.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-muted">
                      <span className="font-mono">{cc.code}</span> {cc.name}
                    </p>
                    <Input
                      size="sm"
                      value={row.name}
                      disabled={!row.on}
                      maxLength={SHORT_NAME_MAX}
                      onChange={(e) => set(cc.id, { name: e.target.value })}
                      aria-label={t("editShortName", { code: cc.code })}
                      className="mt-1"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>
    </>
  );
}
