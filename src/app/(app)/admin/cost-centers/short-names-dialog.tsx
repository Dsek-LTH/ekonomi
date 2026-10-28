"use client";

// The suggested short names, for a person to look over before any of them is
// saved. The rule that made them (lib/domain/cost-center-short-name.ts) only
// proposes: each row can be dropped or reworded here, and nothing is stored
// until Spara. See `shortName` on CostCenter in the schema.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/field";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { useMutation } from "@/components/shell/use-mutation";
import { SHORT_NAME_MAX } from "@/lib/domain/cost-center-short-name";
import type { CostCenter } from "@/lib/domain/types";

export interface Suggestion {
  cc: CostCenter;
  shortName: string;
}

export function ShortNamesDialog({
  suggestions,
  onClose,
}: {
  suggestions: Suggestion[];
  onClose: () => void;
}) {
  const t = useTranslations("admin.costCenters");
  const tCommon = useTranslations("common");
  const { pending, mutate } = useMutation();
  // Every suggestion starts ticked, with the rule's wording: the common case is
  // to look down the list and save it. Keyed by cost centre id.
  const [rows, setRows] = useState(() =>
    Object.fromEntries(suggestions.map((s) => [s.cc.id, { on: true, name: s.shortName }])),
  );

  const picked = suggestions.filter((s) => rows[s.cc.id].on);
  const allOn = picked.length === suggestions.length;
  const blocker =
    picked.length === 0 || picked.some((s) => !rows[s.cc.id].name.trim()) ? t("suggestBlocked") : null;

  const set = (id: string, patch: Partial<{ on: boolean; name: string }>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  async function save() {
    const data = await mutate("/api/cost-centers/short-names", {
      key: "save",
      method: "PUT",
      body: { names: picked.map((s) => ({ id: s.cc.id, shortName: rows[s.cc.id].name.trim() })) },
      error: t("suggestFailed"),
      success: t("suggestSaved", { count: picked.length }),
    });
    if (data) onClose();
  }

  return (
    <Modal label={t("suggest")} onClose={onClose} className="max-w-2xl">
      <ModalHeader title={t("suggest")} subtitle={t("suggestSubtitle")} />
      <ModalBody>
        <div className="divide-y divide-border rounded-panel border border-border">
          <div className="flex items-center gap-3 bg-surface px-3 py-2">
            <Checkbox
              checked={allOn}
              indeterminate={!allOn && picked.length > 0}
              onChange={() => {
                const on = !allOn;
                setRows((r) => Object.fromEntries(Object.entries(r).map(([id, v]) => [id, { ...v, on }])));
              }}
              label={t("suggestAll")}
            >
              <span className="text-sm font-medium">{t("suggestAll")}</span>
            </Checkbox>
          </div>
          {suggestions.map(({ cc }) => {
            const row = rows[cc.id];
            return (
              // The full name over the field, so what is being shortened is
              // in sight while the short name is worded.
              <div key={cc.id} className="flex items-start gap-3 px-3 py-2.5">
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
      </ModalBody>
      <ModalFooter blocker={blocker}>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={save} disabled={Boolean(blocker)} loading={pending === "save"}>
            {t("suggestSave", { count: picked.length })}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
