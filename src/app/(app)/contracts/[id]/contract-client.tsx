"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DetailList, DetailRow } from "@/components/ui/detail-list";
import { DateInput, Field, Input, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tag } from "@/components/ui/status-pill";
import { IconTrash, IconUpload } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useFormat } from "@/lib/ui/use-format";
import { CONTRACT_STATUS_TONE, displayStatus } from "@/lib/contract/status";
import { isImmutable } from "@/lib/contract/file-roles";
import { isCompleteDate } from "@/lib/domain/date";
import type { ContractDetail } from "@/lib/data/contracts";
import type { ContractStatus } from "@/lib/domain/types";
import { RentalPanel } from "./rental-panel";
import { PartiesPanel } from "./parties-panel";

const STATUSES: readonly ContractStatus[] = [
  "DRAFT",
  "OUT_FOR_SIGNATURE",
  "SIGNED",
  "TERMINATED",
  "CANCELLED",
];

const MAX_MB = 50;

export function ContractClient({
  contract,
  today,
  canManage,
}: {
  contract: ContractDetail;
  today: string;
  canManage: boolean;
}) {
  const t = useTranslations("contracts");
  const router = useRouter();
  const confirm = useConfirm();
  const { mutate, pending } = useMutation();
  const { date } = useFormat();

  const [editing, setEditing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const status = displayStatus(contract, today);

  async function uploadFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("role", "ORIGINAL");
    await mutate(`/api/contracts/${contract.id}/files`, { body: form, key: "upload" });
  }

  async function removeFile(fileId: string, filename: string) {
    const ok = await confirm({
      title: t("detail.deleteFile"),
      message: t("detail.deleteFileConfirm", { filename }),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/contracts/${contract.id}/files/${fileId}`, {
      method: "DELETE",
      key: fileId,
    });
  }

  async function removeContract() {
    const ok = await confirm({
      title: t("detail.deleteContract"),
      message: t("detail.deleteContractConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    const gone = await mutate(`/api/contracts/${contract.id}`, {
      method: "DELETE",
      key: "delete",
      refresh: false,
    });
    if (gone !== null) router.push("/contracts");
  }

  const validity =
    contract.validFrom && contract.validTo
      ? t("validity.range", { from: date(contract.validFrom), to: date(contract.validTo) })
      : contract.validFrom
        ? t("validity.fromOnly", { from: date(contract.validFrom) })
        : contract.validTo
          ? t("validity.toOnly", { to: date(contract.validTo) })
          : t("validity.none");

  return (
    <PageShell
      title={contract.title}
      subtitle={contract.counterparty}
      back={{ href: "/contracts", label: t("detail.back") }}
      width="content"
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={CONTRACT_STATUS_TONE[status]}>{t(`status.${status}`)}</Tag>
          <Tag>{t(`kind.${contract.kind}`)}</Tag>
          {contract.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>

        {/* ── Uppgifter ───────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title={t("detail.details")}
            action={
              canManage ? (
                <Button variant="secondary" size="sm" onClick={() => setEditing((v) => !v)}>
                  {editing ? t("form.cancel") : t("detail.edit")}
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            {editing ? (
              <EditFields contract={contract} onDone={() => setEditing(false)} />
            ) : (
              <DetailList>
                <DetailRow label={t("col.kind")} value={t(`kind.${contract.kind}`)} />
                <DetailRow label={t("col.counterparty")} value={contract.counterparty} />
                {contract.counterpartyOrgNo && (
                  <DetailRow
                    label={t("form.counterpartyOrgNo")}
                    value={contract.counterpartyOrgNo}
                  />
                )}
                <DetailRow label={t("col.validity")} value={validity} />
                {contract.notes && <DetailRow label={t("detail.notes")} value={contract.notes} />}
                {contract.createdBy && (
                  <DetailRow
                    label={t("detail.filedBy", { name: contract.createdBy })}
                    value={date(contract.createdAt)}
                  />
                )}
                {contract.termsVersion && (
                  <DetailRow
                    label={t("detail.termsVersion", { version: contract.termsVersion })}
                    value=""
                  />
                )}
              </DetailList>
            )}
          </CardBody>
        </Card>

        {/* ── Uthyrning ───────────────────────────────────────────── */}
        {contract.rental && (
          <RentalPanel
            contractId={contract.id}
            status={contract.status}
            rental={contract.rental}
            canManage={canManage}
          />
        )}

        {/* ── Dokument ────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title={t("detail.documents")}
            action={
              canManage ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadFile(f);
                      // Cleared, so picking the same file twice in a row still
                      // fires a change event.
                      e.target.value = "";
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={pending === "upload"}
                    onClick={() => fileRef.current?.click()}
                  >
                    <IconUpload className="size-4" />
                    {t("detail.addDocument")}
                  </Button>
                </>
              ) : undefined
            }
          />
          <CardBody>
            {contract.files.length === 0 ? (
              <p className="text-sm text-muted">
                {t("detail.noDocuments")}{" "}
                <span className="text-xs">{t("form.fileHint", { max: MAX_MB })}</span>
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {contract.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                    <Tag>{t(`detail.role.${f.role}`)}</Tag>
                    <a
                      href={`/api/contracts/${contract.id}/files/${f.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-sm text-accent hover:underline"
                    >
                      {f.filename}
                    </a>
                    <span className="text-xs text-muted">{date(f.createdAt)}</span>
                    {canManage && !isImmutable(f.role) && (
                      <Button
                        variant="dangerOutline"
                        size="sm"
                        loading={pending === f.id}
                        onClick={() => removeFile(f.id, f.filename)}
                      >
                        <IconTrash className="size-4" />
                        <span className="sr-only">{t("detail.deleteFile")}</span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* ── Parter ──────────────────────────────────────────────── */}
        <PartiesPanel
          contractId={contract.id}
          parties={contract.parties}
          canManage={canManage}
        />

        {canManage && (
          <div className="flex justify-end">
            <Button
              variant="dangerOutline"
              loading={pending === "delete"}
              onClick={removeContract}
            >
              {t("detail.deleteContract")}
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}

/** The archive fields, as a form. Split out so the read view above stays one
 *  glance rather than a component with two modes woven through it. */
function EditFields({
  contract,
  onDone,
}: {
  contract: ContractDetail;
  onDone: () => void;
}) {
  const t = useTranslations("contracts");
  const { mutate, pending } = useMutation();

  const [title, setTitle] = useState(contract.title);
  const [counterparty, setCounterparty] = useState(contract.counterparty);
  const [orgNo, setOrgNo] = useState(contract.counterpartyOrgNo ?? "");
  const [validFrom, setValidFrom] = useState(contract.validFrom ?? "");
  const [validTo, setValidTo] = useState(contract.validTo ?? "");
  const [status, setStatus] = useState<ContractStatus>(contract.status);
  const [tags, setTags] = useState(contract.tags.join(", "));
  const [notes, setNotes] = useState(contract.notes ?? "");

  // An emptied date field clears the column; a half-typed one is left alone,
  // which is what `undefined` means to the patch schema.
  const dateField = (v: string) => (v === "" ? null : isCompleteDate(v) ? v : undefined);

  async function save() {
    const saved = await mutate(`/api/contracts/${contract.id}`, {
      method: "PATCH",
      body: {
        title: title.trim(),
        counterparty: counterparty.trim(),
        counterpartyOrgNo: orgNo.trim() || null,
        validFrom: dateField(validFrom),
        validTo: dateField(validTo),
        status,
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
        notes: notes.trim() || null,
      },
      success: t("detail.saved"),
    });
    if (saved !== null) onDone();
  }

  return (
    <div className="space-y-5">
      <Field label={t("form.title")}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      <Field label={t("form.counterparty")}>
        <Input
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          maxLength={200}
        />
      </Field>
      <Field label={t("form.counterpartyOrgNo")}>
        <Input value={orgNo} onChange={(e) => setOrgNo(e.target.value)} maxLength={40} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("form.validFrom")}>
          <DateInput value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label={t("form.validTo")}>
          <DateInput value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
      </div>
      <Field label={t("form.status")}>
        <SegmentedControl
          options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
          value={status}
          onChange={setStatus}
          size="sm"
        />
      </Field>
      <Field label={t("form.tags")} hint={t("form.tagsHint")}>
        <Input value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <Field label={t("form.notes")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("form.cancel")}
        </Button>
        <Button onClick={save} loading={pending !== null}>
          {t("detail.save")}
        </Button>
      </div>
    </div>
  );
}
