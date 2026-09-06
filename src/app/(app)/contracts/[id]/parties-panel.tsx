"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateInput, Field, Input } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tag } from "@/components/ui/status-pill";
import { IconTrash } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useFormat } from "@/lib/ui/use-format";
import { isCompleteDate } from "@/lib/domain/date";
import type { ContractPartyRow } from "@/lib/data/contracts";
import type { ContractPartyRole } from "@/lib/domain/types";

const ROLES: readonly ContractPartyRole[] = ["SECTION", "COUNTERPARTY"];

/**
 * Who signed, and in what capacity.
 *
 * Worth its own panel because it is the half of an archived contract somebody
 * types in long after the fact: a 2019 scan has two signatures on it, and the
 * names are the thing a later reader actually needs when the agreement is
 * disputed. Nothing here witnesses a signature. It records one.
 */
export function PartiesPanel({
  contractId,
  parties,
  canManage,
}: {
  contractId: string;
  parties: ContractPartyRow[];
  canManage: boolean;
}) {
  const t = useTranslations("contracts");
  const confirm = useConfirm();
  const { mutate, pending } = useMutation();
  const { date } = useFormat();
  const [adding, setAdding] = useState(false);

  async function remove(id: string, name: string) {
    const ok = await confirm({
      title: t("party.remove"),
      message: name,
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/contracts/${contractId}/parties/${id}`, { method: "DELETE", key: id });
  }

  return (
    <Card>
      <CardHeader
        title={t("detail.parties")}
        action={
          canManage ? (
            <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
              {adding ? t("form.cancel") : t("detail.addParty")}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-5">
        {parties.length === 0 ? (
          <p className="text-sm text-muted">{t("detail.noParties")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {parties.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                <Tag>{t(`detail.partyRole.${p.role}`)}</Tag>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {[p.title, p.orgName, p.email].filter(Boolean).join(" – ") || "–"}
                  </span>
                </span>
                <span className="text-xs text-muted">
                  {p.signedAt
                    ? `${t("detail.signedOn", { date: date(p.signedAt) })}${
                        p.signatureMethod ? ` (${t(`detail.method.${p.signatureMethod}`)})` : ""
                      }`
                    : t("detail.notSigned")}
                </span>
                {canManage && (
                  <Button
                    variant="dangerOutline"
                    size="sm"
                    loading={pending === p.id}
                    onClick={() => remove(p.id, p.name)}
                  >
                    <IconTrash className="size-4" />
                    <span className="sr-only">{t("party.remove")}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {adding && canManage && (
          <AddParty contractId={contractId} onDone={() => setAdding(false)} />
        )}
      </CardBody>
    </Card>
  );
}

function AddParty({ contractId, onDone }: { contractId: string; onDone: () => void }) {
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
      <Field label={t("party.role")}>
        <SegmentedControl
          options={ROLES.map((r) => ({ value: r, label: t(`detail.partyRole.${r}`) }))}
          value={role}
          onChange={setRole}
          size="sm"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("party.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t("party.title")} hint={t("party.titleHint")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t("party.orgName")}>
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t("party.email")}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field label={t("party.phone")}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
        </Field>
        <Field label={t("party.signedAt")}>
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
