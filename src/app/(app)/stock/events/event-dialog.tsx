"use client";

// Naming an event, and renaming or moving one later.
//
// Two fields, and the reason it is a form at all rather than a text box on a
// movement: an event is picked from a list afterwards, so "Onsdagspub" and
// "onsdagspub " cannot become two nights. Creating one is a deliberate act with
// its own moment, which is also the moment somebody knows what to call it.
//
// The same two fields edit one. A night entered under the wrong day is the
// ordinary mistake, and the date is set here and nowhere else.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateInput, Field, Input } from "@/components/ui/field";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { useMutation } from "@/components/shell/use-mutation";
import type { CreateStockEvent, PatchStockEvent } from "@/lib/api/schemas/stock";

const today = () => new Date().toISOString().slice(0, 10);

export function EventDialog({
  event,
  onClose,
}: {
  /** The event being edited. Absent when creating one. */
  event?: { id: string; name: string; date: string };
  onClose: () => void;
}) {
  const t = useTranslations("stock");
  const router = useRouter();
  const { pending, mutate } = useMutation();
  const [name, setName] = useState(event?.name ?? "");
  const [date, setDate] = useState(event?.date ?? today());

  const named = name.trim() !== "";
  const dated = date !== "";
  const title = event ? t("event.edit") : t("event.new");

  async function save() {
    if (event) {
      const body: PatchStockEvent = { name: name.trim(), date };
      const done = await mutate(`/api/stock/events/${event.id}`, {
        method: "PATCH",
        body,
        error: t("event.editFailed"),
        success: t("event.edited"),
      });
      if (done) onClose();
      return;
    }

    const body: CreateStockEvent = { name: name.trim(), date };
    const made = await mutate<{ id: string }>("/api/stock/events", {
      method: "POST",
      body,
      error: t("event.saveFailed"),
    });
    if (!made) return;
    onClose();
    // Straight into it. Making an event is never the errand. The errand is
    // the crates by the door.
    router.push(`/stock/events/${made.id}`);
  }

  return (
    <Modal label={title} onClose={onClose} className="max-w-md">
      <ModalHeader title={title} subtitle={event ? t("event.editHint") : t("event.newHint")} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        <Field
          label={t("event.field.name")}
          hint={t("event.field.nameHint")}
          requirement="required"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("event.field.namePlaceholder")}
            autoFocus
          />
        </Field>
        <Field label={t("event.field.date")} requirement="required">
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <ModalFooter blocker={named ? null : t("event.field.nameRequired")}>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={!named || !dated || pending !== null}>
            {event ? t("save") : t("event.create")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
