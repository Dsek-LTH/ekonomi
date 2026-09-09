"use client";

// One dialog for both jobs: `counterparty` is null when adding and a row when
// editing. Same shape as item-dialog.tsx, the gear catalogue's equivalent.
//
// Also opened from inside the two contract-creation forms, when somebody
// types a name the directory doesn't have yet: the picker offers what was
// typed as something to create (see components/ui/combobox.tsx's `onCreate`),
// and this is the form that opens with it filled in, the same idiom the
// stock sheet uses for a new product. `onSaved` is how that caller gets the
// new row back to select it; the settings screen at counterparties-client.tsx
// leaves it unset and relies on the page refreshing instead.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import type { CounterpartyOption, CounterpartyRow } from "@/lib/data/counterparties";

export function CounterpartyDialog({
  counterparty,
  initialName,
  onClose,
  onSaved,
}: {
  /** Null to add one. */
  counterparty: CounterpartyRow | null;
  /** Prefills the name when adding, for the "create from what was typed" flow. */
  initialName?: string;
  onClose: () => void;
  /** Called with the row once a *new* counterparty is saved. */
  onSaved?: (created: CounterpartyOption) => void;
}) {
  const t = useTranslations("contracts.counterparties");
  const confirm = useConfirm();
  const { mutate, pending } = useMutation();

  const [name, setName] = useState(counterparty?.name ?? initialName ?? "");
  const [orgNo, setOrgNo] = useState(counterparty?.orgNo ?? "");
  const [address, setAddress] = useState(counterparty?.address ?? "");
  const [postalCode, setPostalCode] = useState(counterparty?.postalCode ?? "");
  const [city, setCity] = useState(counterparty?.city ?? "");
  const [notes, setNotes] = useState(counterparty?.notes ?? "");

  const blocker = name.trim() === "" ? t("blocker.name") : null;

  const body = {
    name: name.trim(),
    orgNo: orgNo.trim() || null,
    address: address.trim() || null,
    postalCode: postalCode.trim() || null,
    city: city.trim() || null,
    notes: notes.trim() || null,
  };

  async function save() {
    if (counterparty) {
      const saved = await mutate(`/api/counterparties/${counterparty.id}`, {
        method: "PATCH",
        body,
        key: "save",
        success: t("saved"),
      });
      if (saved !== null) onClose();
      return;
    }
    const created = await mutate<CounterpartyOption>("/api/counterparties", {
      body,
      key: "save",
      success: t("added"),
    });
    if (created !== null) {
      onSaved?.(created);
      onClose();
    }
  }

  async function remove() {
    if (!counterparty) return;
    const ok = await confirm({
      title: t("remove"),
      message: t("removeConfirm", { name: counterparty.name }),
      tone: "danger",
    });
    if (!ok) return;
    // A counterparty a contract points at comes back retired rather than
    // deleted. The route decides that, not this dialog.
    const gone = await mutate(`/api/counterparties/${counterparty.id}`, {
      method: "DELETE",
      key: "remove",
    });
    if (gone !== null) onClose();
  }

  async function toggleActive() {
    if (!counterparty) return;
    const saved = await mutate(`/api/counterparties/${counterparty.id}`, {
      method: "PATCH",
      body: { active: !counterparty.active },
      key: "active",
      success: t("saved"),
    });
    if (saved !== null) onClose();
  }

  return (
    <Modal
      label={counterparty ? t("edit") : t("add")}
      onClose={onClose}
      className="max-w-lg"
    >
      <ModalHeader
        title={counterparty ? t("edit") : t("add")}
        subtitle={
          counterparty && counterparty.usedBy > 0
            ? t("inUse", { count: counterparty.usedBy })
            : undefined
        }
      />
      <ModalBody>
        <div className="space-y-5">
          <Field label={t("name")}>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </Field>

          <Field label={t("orgNo")} hint={t("orgNoHint")}>
            <Input value={orgNo} onChange={(e) => setOrgNo(e.target.value)} maxLength={40} />
          </Field>

          <Field label={t("address")}>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
              maxLength={200}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field label={t("postalCode")}>
              <Input
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                autoComplete="postal-code"
                inputMode="numeric"
                maxLength={20}
              />
            </Field>
            <Field label={t("city")}>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                autoComplete="address-level2"
                maxLength={100}
              />
            </Field>
          </div>

          <Field label={t("notes")} hint={t("notesHint")}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>

          {counterparty && counterparty.usedBy > 0 && (
            <p className="text-xs text-muted">{t("editSafe")}</p>
          )}
        </div>
      </ModalBody>

      <ModalFooter blocker={blocker}>
        {counterparty ? (
          <div className="flex items-center gap-2">
            <Button
              variant="dangerOutline"
              size="sm"
              loading={pending === "remove"}
              onClick={remove}
            >
              {t("remove")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={pending === "active"}
              onClick={toggleActive}
            >
              {counterparty.active ? t("retire") : t("restore")}
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={Boolean(blocker)} loading={pending === "save"}>
            {counterparty ? t("save") : t("add")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
