"use client";

// One contract, read beside the document it is about.
//
// The shape is the one every contract platform converges on, and the page did
// none of it before: the document takes the panel on the right and the column
// on the left describes it, status and signatures first, then the facts, then
// the rental record, then the filing and the history. Actions are one group on
// the status card rather than one per card.
//
// What changed, and why each one:
//
//   The document was a link in a list halfway down. It is the thing the page is
//   about, so it is now in the receipt panel, which exists precisely to keep a
//   document open beside the work (components/receipt/receipt-panel.tsx).
//
//   Whether it was signed was at the bottom, under the documents, inside the
//   parties card. It is the first question anybody has, so it is the first
//   thing on the page. See status-strip.tsx.
//
//   Four actions lived in four card headers and a delete sat at the very
//   bottom, so doing anything meant hunting for where that verb had been put.
//   They are one group now, on the header of the card that *is* the contract,
//   which is where the utlägg page puts its own. See contract-actions.tsx.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DetailList, DetailRow } from "@/components/ui/detail-list";
import { DateInput, Field, FieldGroup, Input, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tag } from "@/components/ui/status-pill";
import { IconTrash } from "@/components/ui/icons";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useFormat } from "@/lib/ui/use-format";
import { isImmutable } from "@/lib/contract/file-roles";
import { isCompleteDate } from "@/lib/domain/date";
import { contractDocuments } from "@/lib/contract/document-url";
import type { ContractDetail } from "@/lib/data/contracts";
import type { ContractStatus } from "@/lib/domain/types";
import { RentalPanel } from "./rental-panel";
import { StatusStrip } from "./status-strip";
import { ContractActions } from "./contract-actions";

const STATUSES: readonly ContractStatus[] = [
  "DRAFT",
  "OUT_FOR_SIGNATURE",
  "SIGNED",
  "TERMINATED",
  "CANCELLED",
];

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

  const hasSignedFiles = contract.files.some((f) => isImmutable(f.role));

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

  async function terminate() {
    const ok = await confirm({
      title: t("detail.terminate"),
      message: t("detail.terminateConfirm"),
    });
    if (!ok) return;
    await mutate(`/api/contracts/${contract.id}`, {
      method: "PATCH",
      body: { status: "TERMINATED" },
      key: "terminate",
      success: t("detail.saved"),
    });
  }

  async function regenerate() {
    await mutate(`/api/contracts/${contract.id}/document`, {
      key: "regenerate",
      success: t("rental.regenerated"),
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
    if (gone !== null) router.push(contract.rental ? "/uthyrning" : "/contracts");
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
      back={
        contract.rental
          ? { href: "/uthyrning", label: t("rental.backToRentals") }
          : { href: "/contracts", label: t("detail.back") }
      }
      width="content"
    >
      {/* The contract itself, in the panel that exists for reading a document
          beside the work. Which files and in what order is one decision, made
          in lib/contract/document-url.ts so this page and any other that shows
          a contract cannot disagree about it. */}
      <ReceiptPanelSource
        documents={contractDocuments(contract)}
        emptyTitle={t("detail.documents")}
        emptyDescription={t("detail.noDocuments")}
      />

      {/* Lives here rather than beside a button, so the same input serves the
          header menu and the documents card below. */}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadFile(f);
          // Cleared, so picking the same file twice in a row still fires.
          e.target.value = "";
        }}
      />

      <div className="space-y-5">
        <StatusStrip
          contract={contract}
          today={today}
          canManage={canManage}
          action={
            <ContractActions
              state={{
                status: contract.status,
                isRental: contract.rental !== null,
                canManage,
                hasSignedFiles,
              }}
              busy={pending !== null}
              onEdit={() => setEditing((v) => !v)}
              onUpload={() => fileRef.current?.click()}
              onRegenerate={regenerate}
              onTerminate={terminate}
              onDelete={removeContract}
            />
          }
        />

        {editing && canManage && (
          <Card>
            <CardHeader title={t("detail.edit")} />
            <CardBody>
              <EditFields contract={contract} onDone={() => setEditing(false)} />
            </CardBody>
          </Card>
        )}

        {contract.rental && (
          <RentalPanel
            contractId={contract.id}
            rental={contract.rental}
            canManage={canManage}
          />
        )}

        {/* Uppgifter and Parter are gone for a rental, and it is worth saying
            what they held rather than leaving a reader to wonder. Uppgifter was
            Typ (obviously a rental), Motpart (the page's own subtitle), Giltigt
            (the status strip's period) and Taggar (empty). Parter repeated the
            strip's list with buttons on it. Both were the same facts a second
            time, which is most of what made this page feel like a pile.

            A contract that is not a rental still needs them, because for one of
            those the kind and the counterparty are not obvious from anything
            else on the page. */}
        {!contract.rental && (
          <Card>
            <CardHeader title={t("detail.details")} />
            <CardBody>
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
              </DetailList>
            </CardBody>
          </Card>
        )}

        {/* ── Dokument ────────────────────────────────────────────── */}
        <Card>
          <CardHeader title={t("detail.documents")} />
          <CardBody>
            {contract.files.length === 0 ? (
              <p className="text-sm text-muted">{t("detail.noDocuments")}</p>
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

        {/* ── Historik ────────────────────────────────────────────── */}
        {/* The archival trivia, all of it, in the one place somebody goes
            looking for it. Org.nr, tags and notes used to have a card of their
            own competing with the contract; here they are what they are, which
            is small print about the filing rather than about the agreement. */}
        <Card>
          <CardHeader title={t("detail.history")} />
          <CardBody className="space-y-4">
            <DetailList>
              {contract.createdBy && (
                <DetailRow
                  label={t("detail.filedByLabel")}
                  value={`${contract.createdBy} – ${date(contract.createdAt)}`}
                />
              )}
              {contract.rental && contract.counterpartyOrgNo && (
                <DetailRow
                  label={t("form.counterpartyOrgNo")}
                  value={contract.counterpartyOrgNo}
                />
              )}
              {contract.tags.length > 0 && (
                <DetailRow
                  label={t("col.tags")}
                  value={
                    <span className="flex flex-wrap justify-end gap-1">
                      {contract.tags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </span>
                  }
                />
              )}
              {contract.termsVersion && (
                <DetailRow
                  label={t("detail.termsVersionLabel")}
                  value={contract.termsVersion}
                />
              )}
            </DetailList>
            {contract.notes && (
              <div>
                <p className="text-xs font-medium text-muted">{t("detail.notes")}</p>
                <p className="mt-1 whitespace-pre-line break-words text-sm">{contract.notes}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </PageShell>
  );
}

/** The archive fields, as a form. Opened from the header's "Redigera" so the
 *  read view stays one glance rather than a component with two modes woven
 *  through it. */
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
  const [address, setAddress] = useState(contract.counterpartyAddress ?? "");
  const [postalCode, setPostalCode] = useState(contract.counterpartyPostalCode ?? "");
  const [city, setCity] = useState(contract.counterpartyCity ?? "");
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
        counterpartyAddress: address.trim() || null,
        counterpartyPostalCode: postalCode.trim() || null,
        counterpartyCity: city.trim() || null,
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
      <Field label={t("form.title")} requirement="required">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      <Field label={t("form.counterparty")} requirement="required">
        <Input
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          maxLength={200}
        />
      </Field>
      <Field label={t("form.counterpartyOrgNo")} requirement="optional">
        <Input value={orgNo} onChange={(e) => setOrgNo(e.target.value)} maxLength={40} />
      </Field>
      <Field label={t("rental.renterAddress")} requirement="optional">
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="street-address"
          maxLength={200}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Field label={t("rental.renterPostalCode")} requirement="optional">
          <Input
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={20}
          />
        </Field>
        <Field label={t("rental.renterCity")} requirement="optional">
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoComplete="address-level2"
            maxLength={100}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("form.validFrom")} requirement="optional">
          <DateInput value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label={t("form.validTo")} requirement="optional">
          <DateInput value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
      </div>
      <FieldGroup label={t("form.status")} requirement="required">
        <SegmentedControl
          options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
          value={status}
          onChange={setStatus}
          size="sm"
        />
      </FieldGroup>
      <Field label={t("form.tags")} hint={t("form.tagsHint")} requirement="optional">
        <Input value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <Field label={t("form.notes")} requirement="optional">
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
