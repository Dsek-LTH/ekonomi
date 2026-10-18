"use client";

// Renaming a budget and setting the day it was adopted.
//
// Both used to be edited in place in the page header: the name was a text box
// that looked like the title, and the date a field beside the lock. A title you
// can type into by accident is a title that gets renamed by accident, and the
// date read as a value rather than as something to change. So they are a dialog
// behind the page's menu, the way an event's name and date are.
//
// The year is not a field. It follows the date, so there is nothing to keep in
// step: clearing the date leaves the year where it was.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DateInput, Field, Input } from "@/components/ui/field";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import type { PatchBudget } from "@/lib/api/schemas/budget";

export function BudgetDialog({
  name: initialName,
  adoptedAt: initialAdoptedAt,
  onSave,
  onClose,
}: {
  name: string;
  adoptedAt: string | null;
  /** Writes the change. Resolves false when the write was refused. */
  onSave: (body: PatchBudget) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations("budget.sheet");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(initialName);
  const [adoptedAt, setAdoptedAt] = useState(initialAdoptedAt ?? "");
  const [saving, setSaving] = useState(false);

  const named = name.trim() !== "";

  async function save() {
    const body: PatchBudget = {};
    if (name.trim() !== initialName) body.name = name.trim();
    if (adoptedAt !== (initialAdoptedAt ?? "")) {
      // Emptying the date is the way back to "never adopted", for a budget
      // recorded as decided by mistake.
      if (adoptedAt) {
        body.adoptedAt = adoptedAt;
        body.year = Number(adoptedAt.slice(0, 4));
      } else {
        body.adoptedAt = null;
      }
    }
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (await onSave(body)) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal label={t("edit")} onClose={onClose} className="max-w-md">
      <ModalHeader title={t("edit")} subtitle={t("editHint")} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        <Field label={t("field.name")} requirement="required">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            autoFocus
          />
        </Field>
        <Field label={t("field.adoptedAt")} hint={t("field.adoptedAtHint")} requirement="optional">
          <DateInput value={adoptedAt} onChange={(e) => setAdoptedAt(e.target.value)} />
        </Field>
      </div>
      <ModalFooter blocker={named ? null : t("nameRequired")}>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={save} disabled={!named} loading={saving}>
            {t("editSave")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
