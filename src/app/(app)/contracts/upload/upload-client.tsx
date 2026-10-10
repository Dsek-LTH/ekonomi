"use client";

// Filing an agreement that already exists.
//
// One of the two doors into the archive, and the one that writes nothing. What
// it does is take an agreement that was signed somewhere else, often years ago
// and on paper, and record it here. The other door is contracts/rental/new,
// which is the only place in the app where a contract comes into being: it
// takes answers and draws a document out of them.
//
// Both used to be called "Nytt avtal", side by side on the list's toolbar in
// the same button, which said the same thing about copying a PDF into a folder
// and about authoring an agreement between two parties. They are named for
// their verbs now, and each page offers the other one at the foot, so somebody
// who took the wrong door has a way across before they have typed anything.
//
// The document leads. Whoever opens this page is holding a PDF, and that is
// usually the whole reason they are here: the dates, the org number and the
// counterparty are all read off it. So the panel is declared with an `onFile`
// and stands open as a dropzone from the first paint, the same arrangement the
// utlägg wizard uses for a receipt. Drop the file, then fill the form in with
// it beside you rather than in another window.
//
// Three cards, each one subject, matching the uthyrningsavtal form next door:
// what the agreement is, how long it runs, and how it gets found again. It was
// nine fields in one flat column with the same gap between all of them, so
// nothing said where "what is this" ended and "how do we file it" began.
//
// Widths are container queries, not viewport breakpoints. The panel beside this
// form can be dragged, so the form's width changes while the viewport does not
// move at all, and `sm:` asks the wrong question. Same reason as the rental
// form and AllocationEditor.
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
  // Whether the file is the signed copy, which is what makes an agreement
  // Signerat (see lib/contract/status.ts). Yes by default: what is filed here
  // was signed somewhere else far more often than not.
  const [fileIsSigned, setFileIsSigned] = useState(true);
  const [title, setTitle] = useState("");

  // The directory, picked from rather than typed. New rows made on the fly
  // (see the Combobox's `onCreate` below) join this list so they can be
  // selected the moment they exist, without a round trip back to the server.
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

  // The document, held here until the contract it belongs to exists. There is
  // nothing to attach it to before the save, which is also why the panel shows
  // it from a local URL rather than from an address in the archive.
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // One cleanup covers both ways a preview ends, a second file replacing the
  // first and the page going away, because either is this value changing.
  // Without it the browser holds the file for as long as the tab lives.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handleFile = (picked: File) => {
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  };

  // A half-typed date is a real state of a masked field, so a date is only sent
  // once it is whole. Same rule the expense form applies, from the same helper.
  const dateOrNull = (v: string) => (isCompleteDate(v) ? v : null);
  // CONTRACT is the one kind that is an agreement with somebody, states a
  // period and carries a status. PROTOCOL/OTHER are both the same lean shape
  // instead: a title, one date, tags, notes, a file. See
  // prisma/schema/contract.prisma.
  const isAgreement = kind === "CONTRACT";
  // Everything but a meeting's minutes may name who it is with. Required for
  // CONTRACT, optional for OTHER: naming a counterparty on an OTHER document
  // does not make it an agreement, so it never asks for a period or a status.
  const showCounterparty = kind !== "PROTOCOL";
  const ready =
    title.trim() !== "" &&
    (isAgreement
      ? counterparty.trim() !== ""
      : kind !== "PROTOCOL" || isCompleteDate(date));

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
        // Split here and normalised on the server, which is the only place that
        // decides what a tag looks like. See lib/contract/tags.ts.
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
        notes: notes.trim() || null,
      },
      // No success message: the upload below may still fail, and saying "saved"
      // before the document is in would be the wrong half of the news.
      refresh: false,
    });
    if (!created) return;

    if (file) {
      const form = new FormData();
      form.append("file", file);
      // The signed copy only for an agreement, since a lean document has no
      // status for it to settle.
      form.append("role", isAgreement && fileIsSigned ? "SIGNED" : "ORIGINAL");
      const uploaded = await mutate(`/api/contracts/${created.id}/files`, {
        body: form,
        refresh: false,
      });
      // The contract exists either way, so a failed upload goes to the contract
      // rather than back to an empty form: the document can be added there, and
      // filing the same contract twice is worse than one without its PDF.
      if (!uploaded) {
        router.push(`/contracts/${created.id}`);
        return;
      }
    }

    router.push(`/contracts/${created.id}`);
  }

  const busy = pending !== null;

  return (
    <PageShell
      title={t("form.uploadTitle")}
      width="content"
      back="/contracts"
    >
      {/* The panel is where the document goes and where it is read, which is
          one place rather than two. Declared with `onFile` and nothing to show,
          so it opens as a dropzone and becomes a viewer the moment a file
          lands. The copy is passed because the panel's own wording is about
          receipts; see UploadCopy. */}
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
            {/* FieldGroup, not Field: a segment is a <button>, and a <label>
                forwards a click anywhere in its box to the first labelable
                element inside it, so clicking the word "Dokumenttyp" picked the
                first typ. */}
            <FieldGroup label={t("form.kind")} requirement="required">
              <SegmentedControl
                options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
                value={kind}
                onChange={setKind}
              />
            </FieldGroup>

            {/* Hidden rather than shown-and-optional for PROTOCOL: a
                meeting's minutes is never with anybody, and asking "who is
                this with" is the wrong question there, not an optional one.
                OTHER gets it too, optionally: see AgreementDetails.counterparty. */}
            {showCounterparty && (
              <div className="grid gap-4 @xl:grid-cols-[2fr_1fr]">
                <FieldGroup
                  label={t("form.counterparty")}
                  hint={t("form.counterpartyHint")}
                  requirement={isAgreement ? "required" : "optional"}
                  action={
                    <button
                      type="button"
                      onClick={() => setNewCounterpartyName("")}
                      className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                    >
                      <IconPlus className="size-3.5" />
                      {tc("add")}
                    </button>
                  }
                >
                  <Combobox
                    autoFocus
                    options={counterpartyOptions.map((c) => ({ value: c.id, label: c.name }))}
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

            {/* Asked only once there is a file to say it about. Without one the
                agreement is filed as a draft, and its signed copy can be
                uploaded from its own page later. */}
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
          // A lean document has no period and no status: it is filed or it
          // doesn't exist. Just the one date, required for a protocol
          // (pretty much the whole of what one states), left to the filer
          // for OTHER.
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
            {/* The section's existing vocabulary, offered by the browser rather
                than drawn by us: the field takes several comma-separated tags,
                which a Combobox over one value cannot express. */}
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

        {/* Why the button is grey, beside the button. It used to be disabled and
            silent, which left the only unanswered question on the page with
            nowhere to read the answer. Same wording register as the utlägg
            wizard's submit blocker, and the same colour. */}
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

        {/* The other door. Below the buttons rather than among them: it is not
            a third thing to do with this form, it is the way out of the wrong
            one, and it is offered here because nothing has been typed that
            walking through it would lose. */}
        <p className="text-xs text-muted">
          {t("form.otherKind")}{" "}
          <button
            type="button"
            onClick={() => router.push("/contracts/rental/new")}
            className="font-medium text-accent hover:underline"
          >
            {t("form.otherKindLink")}
          </button>
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
