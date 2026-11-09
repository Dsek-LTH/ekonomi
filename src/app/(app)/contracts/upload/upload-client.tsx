"use client";

// Filing an agreement signed elsewhere (the other door is contracts/rental/new). The document leads: the panel is a
// dropzone from first paint. Widths are container queries (the panel beside the form can be dragged).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput, Field, FieldGroup, Input, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Checkbox } from "@/components/ui/checkbox";
import { IconPlus } from "@/components/ui/icons";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useMutation } from "@/components/shell/use-mutation";
import { isCompleteDate } from "@/lib/domain/date";
import { CounterpartyDialog } from "../counterparties/counterparty-dialog";
import type { CounterpartyOption } from "@/lib/data/counterparties";
import type { ContractKind } from "@/lib/domain/types";

const KINDS: readonly ContractKind[] = ["CONTRACT", "PROTOCOL", "OTHER"];

/** Kept in step with MAX_BYTES in the upload route, for the hint only. */
const MAX_MB = 50;

export function UploadContractClient({
  knownTags,
  counterparties,
}: {
  knownTags: string[];
  counterparties: CounterpartyOption[];
}) {
  const t = useTranslations("contracts");
  const tc = useTranslations("contracts.counterparties");
  const router = useRouter();
  const { mutate, pending } = useMutation();

  const [kind, setKind] = useState<ContractKind>("CONTRACT");
  // Whether the file is the signed copy, which makes an agreement Signerat (lib/contract/status.ts). Default yes.
  const [fileIsSigned, setFileIsSigned] = useState(true);
  const [title, setTitle] = useState("");

  // The directory, picked from. Rows created on the fly join it so they can be selected at once.
  const [counterpartyOptions, setCounterpartyOptions] = useState(counterparties);
  const [counterpartyId, setCounterpartyId] = useState<string | null>(null);
  // What was typed and offered as something to create, until the dialog it
  // opens is closed. Null means the dialog is shut.
  const [newCounterpartyName, setNewCounterpartyName] = useState<string | null>(null);
  const counterparty = counterpartyOptions.find((c) => c.id === counterpartyId)?.name ?? "";
  const [orgNo, setOrgNo] = useState("");

  function pickCounterparty(id: string) {
    setCounterpartyId(id || null);
    const picked = counterpartyOptions.find((c) => c.id === id);
    setOrgNo(picked?.orgNo ?? "");
  }

  function counterpartyCreated(created: CounterpartyOption) {
    setCounterpartyOptions((prev) => [...prev, created]);
    setCounterpartyId(created.id);
    setOrgNo(created.orgNo ?? "");
    setNewCounterpartyName(null);
  }
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  // The one date a lean document (PROTOCOL, OTHER) needs, in place of the
  // period above: see Contract.date.
  const [date, setDate] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  // The document is held here until the contract exists, so the panel shows it from a local URL.
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // One cleanup covers a replaced file and unmount; otherwise the browser holds the file for the life of the tab.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handleFile = (picked: File) => {
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  };

  // A masked date is only sent once whole (same rule as the expense form).
  const dateOrNull = (v: string) => (isCompleteDate(v) ? v : null);
  // CONTRACT is the one kind with a period and status; PROTOCOL/OTHER are the lean shape. See prisma/schema/contract.prisma.
  const isAgreement = kind === "CONTRACT";
  // Everything but a meeting's minutes may name who it is with: required for CONTRACT, optional for OTHER (no period or status).
  const showCounterparty = kind !== "PROTOCOL";
  const ready =
    title.trim() !== "" &&
    (isAgreement ? counterparty.trim() !== "" : kind !== "PROTOCOL" || isCompleteDate(date));

  async function save() {
    const created = await mutate<{ id: string }>("/api/contracts", {
      body: {
        kind,
        title: title.trim(),
        counterparty: counterparty.trim(),
        counterpartyOrgNo: orgNo.trim() || null,
        counterpartyId,
        validFrom: dateOrNull(validFrom),
        validTo: dateOrNull(validTo),
        date: dateOrNull(date),
        // Split here, normalised on the server (lib/contract/tags.ts).
        tags: tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        notes: notes.trim() || null,
      },
      // No success message: the upload below may still fail.
      refresh: false,
    });
    if (!created) return;

    if (file) {
      const form = new FormData();
      form.append("file", file);
      // The signed copy only for an agreement (a lean document has no status).
      form.append("role", isAgreement && fileIsSigned ? "SIGNED" : "ORIGINAL");
      const uploaded = await mutate(`/api/contracts/${created.id}/files`, {
        body: form,
        refresh: false,
      });
      // The contract exists either way, so a failed upload goes to the contract, where the document can be added.
      if (!uploaded) {
        router.push(`/contracts/${created.id}`);
        return;
      }
    }

    router.push(`/contracts/${created.id}`);
  }

  const busy = pending !== null;

  return (
    <PageShell title={t("form.uploadTitle")} width="content" back="/contracts">
      {/* The panel is dropzone and viewer in one: declared with `onFile`, with its own copy (see UploadCopy). */}
      <ReceiptPanelSource
        previewUrl={previewUrl}
        mimeType={file?.type}
        filename={file?.name}
        onFile={handleFile}
        uploadCopy={{
          lead: t("form.dropzone"),
          leadShort: t("form.dropzoneShort"),
          fileTypes: t("form.fileHint", { max: MAX_MB }),
          action: t("form.pickFile"),
        }}
      />

      <div className="space-y-5">
        {/* ── Dokumentet ───────────────────────────────────────── */}
        <Card>
          <CardHeader
            title={t("form.sectionAgreement")}
            subtitle={
              showCounterparty
                ? t("form.sectionAgreementHint")
                : t("form.sectionAgreementHintNoCounterparty")
            }
          />
          <CardBody className="@container space-y-4">
            {/* FieldGroup, not Field: a <label> would forward clicks on the word to the first segment. */}
            <FieldGroup label={t("form.kind")} requirement="required">
              <SegmentedControl
                options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
                value={kind}
                onChange={setKind}
              />
            </FieldGroup>

            {/* Hidden for PROTOCOL (minutes are never with anybody); optional for OTHER, see AgreementDetails.counterparty. */}
            {showCounterparty && (
              <div className="grid gap-4 @xl:grid-cols-[2fr_1fr]">
                <FieldGroup
                  label={t("form.counterparty")}
                  hint={t("form.counterpartyHint")}
                  requirement={isAgreement ? "required" : "optional"}
                  action={
                    <Button
                      variant="link"
                      type="button"
                      onClick={() => setNewCounterpartyName("")}
                      className="flex items-center gap-1 text-xs"
                    >
                      <IconPlus className="size-3.5" />
                      {tc("add")}
                    </Button>
                  }
                >
                  <Combobox
                    autoFocus
                    options={counterpartyOptions.map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                    value={counterpartyId ?? ""}
                    onChange={pickCounterparty}
                    allowClear
                    placeholder={tc("pick")}
                    searchPlaceholder={tc("pick")}
                    onCreate={(text) => setNewCounterpartyName(text)}
                    createLabel={(text) => tc("createNew", { text })}
                    aria-label={t("form.counterparty")}
                  />
                </FieldGroup>
                <Field label={t("form.counterpartyOrgNo")} requirement="optional">
                  <Input value={orgNo} onChange={(e) => setOrgNo(e.target.value)} maxLength={40} />
                </Field>
              </div>
            )}

            <Field label={t("form.title")} hint={t("form.titleHint")} requirement="required">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </Field>

            {/* Asked only once there is a file; without one the agreement is filed as a draft. */}
            {isAgreement && file && (
              <div className="space-y-1">
                <Checkbox
                  checked={fileIsSigned}
                  onChange={() => setFileIsSigned((v) => !v)}
                  label={t("form.fileIsSigned")}
                />
                <p className="text-xs text-muted">{t("form.fileIsSignedHint")}</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* ── Giltighet, eller bara ett datum ────────────────────── */}
        {isAgreement ? (
          <Card>
            <CardHeader
              title={t("form.sectionValidity")}
              subtitle={t("form.sectionValidityHint")}
            />
            <CardBody className="@container">
              <div className="grid gap-4 @xl:grid-cols-2">
                <Field label={t("form.validFrom")} requirement="optional">
                  <DateInput value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
                </Field>
                <Field label={t("form.validTo")} requirement="optional">
                  <DateInput value={validTo} onChange={(e) => setValidTo(e.target.value)} />
                </Field>
              </div>
            </CardBody>
          </Card>
        ) : (
          // A lean document has no period or status: just the one date, required for a protocol, left to the filer for OTHER.
          <Card>
            <CardHeader title={t("form.sectionDate")} subtitle={t("form.sectionDateHint")} />
            <CardBody className="@container">
              <Field
                label={t("form.date")}
                requirement={kind === "PROTOCOL" ? "required" : "optional"}
              >
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </CardBody>
          </Card>
        )}

        {/* ── Arkivering ───────────────────────────────────────── */}
        <Card>
          <CardHeader title={t("form.sectionArchive")} subtitle={t("form.sectionArchiveHint")} />
          <CardBody className="space-y-4">
            <Field label={t("form.tags")} hint={t("form.tagsHint")} requirement="optional">
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                list="contract-tags"
                autoComplete="off"
              />
            </Field>
            {/* Offered by the browser: several comma-separated tags, which a Combobox over one value cannot express. */}
            <datalist id="contract-tags">
              {knownTags.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>

            <Field label={t("form.notes")} hint={t("form.notesHint")} requirement="optional">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
            </Field>
          </CardBody>
        </Card>

        {/* Why the button is grey, beside the button. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-warning">
            {ready ? null : t(isAgreement ? "form.incomplete" : "form.incompleteTitleOnly")}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push("/contracts")} disabled={busy}>
              {t("form.cancel")}
            </Button>
            <Button onClick={save} loading={busy} disabled={!ready}>
              {t("form.save")}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted">
          {t("form.otherKind")}{" "}
          <Button variant="link" type="button" onClick={() => router.push("/contracts/rental/new")}>
            {t("form.otherKindLink")}
          </Button>
        </p>
      </div>

      {newCounterpartyName !== null && (
        <CounterpartyDialog
          counterparty={null}
          initialName={newCounterpartyName}
          onSaved={counterpartyCreated}
          onClose={() => setNewCounterpartyName(null)}
        />
      )}
    </PageShell>
  );
}
