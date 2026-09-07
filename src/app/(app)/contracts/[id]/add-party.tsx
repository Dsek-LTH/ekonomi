"use client";

// The form for recording a party on a contract.
//
// Lifted out of a PartiesPanel that no longer exists. That panel listed the
// same people the status strip already lists, with buttons on them, which was
// the same facts twice. The list stayed on the strip and the form came here.
//
// Nothing in it witnesses a signature. It records one that happened elsewhere:
// on paper, in a meeting, years ago, which is why `signatureMethod` defaults to
// PAPER and why phase 3's electronic signatures are written by the webhook
// rather than through this form.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DateInput, Field, FieldGroup, Input } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useMutation } from "@/components/shell/use-mutation";
import { isCompleteDate } from "@/lib/domain/date";
import type { ContractPartyRole } from "@/lib/domain/types";

const ROLES: readonly ContractPartyRole[] = ["SECTION", "COUNTERPARTY"];

export function AddParty({ contractId, onDone }: { contractId: string; onDone: () => void }) {
  const t = useTranslations("contracts");
  const { mutate, pending } = useMutation();

  const [role, setRole] = useState<ContractPartyRole>("COUNTERPARTY");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [signedAt, setSignedAt] = useState("");

  async function add() {
    const created = await mutate(`/api/contracts/${contractId}/parties`, {
      body: {
        role,
        name: name.trim(),
        title: title.trim() || null,
        orgName: orgName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        signedAt: isCompleteDate(signedAt) ? signedAt : null,
      },
      key: "add-party",
    });
    if (created !== null) onDone();
  }

  return (
    <div className="space-y-4 rounded-xl border border-dashed border-border p-4">
      <FieldGroup label={t("party.role")} requirement="required">
        <SegmentedControl
          options={ROLES.map((r) => ({ value: r, label: t(`detail.partyRole.${r}`) }))}
          value={role}
          onChange={setRole}
          size="sm"
        />
      </FieldGroup>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("party.name")} requirement="required">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t("party.title")} hint={t("party.titleHint")} requirement="optional">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t("party.orgName")} requirement="optional">
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t("party.email")} requirement="optional">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field label={t("party.phone")} requirement="optional">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
        </Field>
        <Field label={t("party.signedAt")} requirement="optional">
          <DateInput value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          {t("form.cancel")}
        </Button>
        <Button size="sm" onClick={add} loading={pending === "add-party"} disabled={!name.trim()}>
          {t("party.add")}
        </Button>
      </div>
    </div>
  );
}
