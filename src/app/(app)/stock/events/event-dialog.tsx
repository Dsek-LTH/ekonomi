"use client";

// Naming an event.
//
// Two fields, and the reason it is a form at all rather than a text box on a
// movement: an event is picked from a list afterwards, so "Onsdagspub" and
// "onsdagspub " cannot become two nights. Creating one is a deliberate act with
// its own moment, which is also the moment somebody knows what to call it.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateInput, Field, Input } from "@/components/ui/field";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { useMutation } from "@/components/shell/use-mutation";
import type { CreateStockEvent } from "@/lib/api/schemas/stock";

const today = () => new Date().toISOString().slice(0, 10);

export function EventDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("stock");
  const router = useRouter();
  const { pending, mutate } = useMutation();
  const [name, setName] = useState("");
  const [date, setDate] = useState(today());

  const named = name.trim() !== "";

  async function save() {
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
    <Modal label={t("event.new")} onClose={onClose} className="max-w-md">
      <ModalHeader title={t("event.new")} subtitle={t("event.newHint")} />
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
          <Button onClick={save} disabled={!named || pending !== null}>
            {t("event.create")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
