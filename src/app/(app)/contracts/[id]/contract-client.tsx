"use client";

// One contract, read beside the document it is about.
//
// The shape is the one every contract platform converges on, and the page did
// none of it before: the document takes the panel on the right and the column
// on the left describes it, status first, then the facts, then
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
import { DateInput, Field, Input, Textarea } from "@/components/ui/field";
import { Tag } from "@/components/ui/status-pill";
import { IconTrash } from "@/components/ui/icons";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useFormat } from "@/lib/ui/use-format";
import { isImmutable, isSigned } from "@/lib/contract/file-roles";
import { isCompleteDate } from "@/lib/domain/date";
import { contractDocuments } from "@/lib/contract/document-url";
import { canEditRental } from "@/lib/contract/status";
import type { ContractDetail } from "@/lib/data/contracts";
import { RentalLinesCard, RentalRecordCard } from "./rental-panel";
import { Fact, Facts } from "./facts";
import { StatusStrip } from "./status-strip";
import { ContractActions } from "./contract-actions";

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

  const hasSignedFiles = contract.files.some((f) => isSigned(f.role) || isImmutable(f.role));
  // CONTRACT is the one kind that is an agreement with somebody: has a
  // status and a validity period. PROTOCOL/OTHER carry none of
  // that. See prisma/schema/contract.prisma.
  const isAgreement = contract.kind === "CONTRACT";
  // Until somebody signs, a rental is changed on the form it was drawn on
  // (contracts/[id]/edit), which redraws the document. See canEditRental.
  const rentalEditable = contract.rental !== null && canEditRental(contract);

  // Which kind of file the picker was opened for. A ref rather than state: it
  // is set the moment before the picker opens and read when it closes, and
  // nothing on screen depends on it.
  const uploadRole = useRef<"SIGNED" | "ORIGINAL">("ORIGINAL");

  function pick(role: "SIGNED" | "ORIGINAL") {
    uploadRole.current = role;
    fileRef.current?.click();
  }

  async function uploadFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("role", uploadRole.current);
    await mutate(`/api/contracts/${contract.id}/files`, { body: form, key: "upload" });
  }

  async function removeFile(fileId: string, filename: string, signed: boolean) {
    const ok = await confirm({
      title: t("detail.deleteFile"),
      // Removing the signed copy is allowed, since a wrong upload has to be
      // fixable, but it changes what the contract is, so it says so.
      message: signed
        ? t("detail.deleteSignedFileConfirm", { filename })
        : t("detail.deleteFileConfirm", { filename }),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/contracts/${contract.id}/files/${fileId}`, {
      method: "DELETE",
      key: fileId,
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

  return (
    <PageShell
      title={contract.title}
      subtitle={contract.counterparty}
      back={contract.rental ? "/uthyrning" : "/contracts"}
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
        {/* The status pill and the action menu, one card: only CONTRACT has
            a status to show. A lean document
            (PROTOCOL, OTHER) is filed or it doesn't exist, with nobody to
            sign it, so its actions ride the details card below instead. */}
        {isAgreement && (
          <StatusStrip
            contract={contract}
            today={today}
            action={
              <ContractActions
                state={{
                  status: contract.status,
                  isRental: contract.rental !== null,
                  editable: rentalEditable,
                  editHref: `/contracts/${contract.id}/edit`,
                  canManage,
                  hasSignedFiles,
                }}
                busy={pending !== null}
                onEdit={() => setEditing((v) => !v)}
                onUpload={() => pick("ORIGINAL")}
                onRegenerate={regenerate}
                onUploadSigned={() => pick("SIGNED")}
                onDelete={removeContract}
              />
            }
          />
        )}

        {editing && canManage && (
          <Card>
            <CardHeader title={contract.rental ? t("detail.editRecord") : t("detail.edit")} />
            <CardBody>
              <EditFields contract={contract} onDone={() => setEditing(false)} />
            </CardBody>
          </Card>
        )}

        {contract.rental && (
          <>
            <RentalLinesCard rental={contract.rental} />
            <RentalRecordCard
              contractId={contract.id}
              rental={contract.rental}
              canManage={canManage}
            />
          </>
        )}

        {/* Uppgifter, for a lean document (PROTOCOL, OTHER) only. An agreement
            says who it is with and for when on the status card above, and this
            card used to say it a second time. A lean document has no status
            card, so its facts and its action menu are here. */}
        {!isAgreement && (
          <Card>
            <CardHeader
              title={t("detail.details")}
              action={
                <ContractActions
                  state={{ status: null, isRental: false, editable: false, canManage, hasSignedFiles }}
                  busy={pending !== null}
                  onEdit={() => setEditing((v) => !v)}
                  onUpload={() => pick("ORIGINAL")}
                  onRegenerate={regenerate}
                  onUploadSigned={() => pick("SIGNED")}
                  onDelete={removeContract}
                />
              }
            />
            <CardBody>
              <Facts>
                <Fact label={t("col.kind")}>{t(`kind.${contract.kind}`)}</Fact>
                <Fact label={t("form.date")}>
                  {contract.date ? date(contract.date) : t("validity.none")}
                </Fact>
                {/* Null for PROTOCOL always, and for an OTHER that named
                    nobody. */}
                {contract.counterparty && (
                  <Fact label={t("col.counterparty")}>
                    <span className="block">{contract.counterparty}</span>
                    {contract.counterpartyOrgNo && (
                      <span className="block text-muted">{contract.counterpartyOrgNo}</span>
                    )}
                  </Fact>
                )}
              </Facts>
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
                        onClick={() => removeFile(f.id, f.filename, isSigned(f.role))}
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

        {/* The filing, as small print under the contract rather than a card
            competing with it: who put it in the archive and when, which wording
            of the terms a drawn contract used, and whatever tags and notes
            somebody left for the next reader. */}
        <footer className="space-y-3 px-1 text-xs text-muted">
          <p>
            {[
              contract.createdBy &&
                t("detail.filedBy", { name: contract.createdBy, date: date(contract.createdAt) }),
              contract.termsVersion &&
                t("detail.termsVersion", { version: contract.termsVersion }),
            ]
              .filter(Boolean)
              .join(". ")}
          </p>
          {contract.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {contract.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          )}
          {contract.notes && (
            <div>
              <p className="font-medium">{t("detail.notes")}</p>
              <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground">
                {contract.notes}
              </p>
            </div>
          )}
        </footer>
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
  // CONTRACT is the one kind with a period and a status; see Contract.agreement.
  const isAgreement = contract.kind === "CONTRACT";
  // Everything but a meeting's minutes may name who it is with, required for
  // CONTRACT and optional for OTHER; see AgreementDetails.counterparty.
  // A rental states who it is with and when on its own form, which redraws the
  // document. The same fields here as well would let the row and the PDF say
  // different things, so for a rental this is only the filing: title, tags
  // and notes.
  const isRental = contract.rental !== null;
  const showCounterparty = contract.kind !== "PROTOCOL" && !isRental;
  const [counterparty, setCounterparty] = useState(contract.counterparty ?? "");
  const [orgNo, setOrgNo] = useState(contract.counterpartyOrgNo ?? "");
  const [address, setAddress] = useState(contract.counterpartyAddress ?? "");
  const [postalCode, setPostalCode] = useState(contract.counterpartyPostalCode ?? "");
  const [city, setCity] = useState(contract.counterpartyCity ?? "");
  const [validFrom, setValidFrom] = useState(contract.validFrom ?? "");
  const [validTo, setValidTo] = useState(contract.validTo ?? "");
  // The one date a lean document (PROTOCOL, OTHER) carries in place of the
  // period above.
  const [date, setDate] = useState(contract.date ?? "");
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
        // Omitted rather than sent empty for OTHER: the field is optional
        // there, and the patch schema's `counterparty` cannot be blanked
        // (see UpdateContract), so an untouched empty field must mean
        // "leave it" rather than "clear it".
        ...(showCounterparty && counterparty.trim() !== ""
          ? { counterparty: counterparty.trim() }
          : {}),
        ...(showCounterparty ? { counterpartyOrgNo: orgNo.trim() || null } : {}),
        ...(isAgreement
          ? isRental
            ? {}
            : {
                counterpartyAddress: address.trim() || null,
                counterpartyPostalCode: postalCode.trim() || null,
                counterpartyCity: city.trim() || null,
                validFrom: dateField(validFrom),
                validTo: dateField(validTo),
              }
          : { date: dateField(date) }),
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
      {showCounterparty && (
        <Field
          label={t("form.counterparty")}
          requirement={isAgreement ? "required" : "optional"}
        >
          <Input
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            maxLength={200}
          />
        </Field>
      )}
      {showCounterparty && (
        <Field label={t("form.counterpartyOrgNo")} requirement="optional">
          <Input value={orgNo} onChange={(e) => setOrgNo(e.target.value)} maxLength={40} />
        </Field>
      )}
      {isAgreement && (
        <>
          {!isRental && (
            <>
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
            </>
          )}
        </>
      )}
      {!isAgreement && (
        <Field label={t("form.date")} requirement={contract.kind === "PROTOCOL" ? "required" : "optional"}>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      )}
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
