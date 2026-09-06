"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateInput, Field, Input, Textarea } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { IconUpload } from "@/components/ui/icons";
import { useMutation } from "@/components/shell/use-mutation";
import { isCompleteDate } from "@/lib/domain/date";
import type { ContractKind, ContractStatus } from "@/lib/domain/types";

const KINDS: readonly ContractKind[] = ["RENTAL", "SPONSORSHIP", "SUPPLIER", "OTHER"];
const STATUSES: readonly ContractStatus[] = ["SIGNED", "DRAFT", "OUT_FOR_SIGNATURE"];

/** Kept in step with MAX_BYTES in the upload route, for the hint only. */
const MAX_MB = 50;

export function NewContractClient({ knownTags }: { knownTags: string[] }) {
  const t = useTranslations("contracts");
  const router = useRouter();
  const { mutate, pending } = useMutation();

  const [kind, setKind] = useState<ContractKind>("SPONSORSHIP");
  const [status, setStatus] = useState<ContractStatus>("SIGNED");
  const [title, setTitle] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [orgNo, setOrgNo] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // A half-typed date is a real state of a masked field, so a date is only sent
  // once it is whole. Same rule the expense form applies, from the same helper.
  const dateOrNull = (v: string) => (isCompleteDate(v) ? v : null);
  const ready = title.trim() !== "" && counterparty.trim() !== "";

  async function save() {
    const created = await mutate<{ id: string }>("/api/contracts", {
      body: {
        kind,
        status,
        title: title.trim(),
        counterparty: counterparty.trim(),
        counterpartyOrgNo: orgNo.trim() || null,
        validFrom: dateOrNull(validFrom),
        validTo: dateOrNull(validTo),
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
      form.append("role", "ORIGINAL");
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
      title={t("form.newTitle")}
      description={t("form.newDescription")}
      width="form"
      back={{ href: "/contracts", label: t("detail.back") }}
    >
      <Card className="space-y-5 p-inset">
        <Field label={t("form.kind")}>
          <SegmentedControl
            options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
            value={kind}
            onChange={setKind}
          />
        </Field>

        <Field label={t("form.title")} hint={t("form.titleHint")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>

        <Field label={t("form.counterparty")} hint={t("form.counterpartyHint")}>
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
          />
        </Field>

        <Field label={t("form.tags")} hint={t("form.tagsHint")}>
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            list="contract-tags"
            autoComplete="off"
          />
        </Field>
        {/* The section's existing vocabulary, offered by the browser rather than
            drawn by us: the field takes several comma-separated tags, which a
            Combobox over one value cannot express. */}
        <datalist id="contract-tags">
          {knownTags.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>

        <Field label={t("form.notes")} hint={t("form.notesHint")}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </Field>

        <Field label={t("form.file")} hint={t("form.fileHint", { max: MAX_MB })}>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              <IconUpload className="size-4" />
              {t("upload")}
            </Button>
            <span className="text-sm text-muted">{file ? file.name : "–"}</span>
          </div>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => router.push("/contracts")} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button onClick={save} loading={busy} disabled={!ready}>
            {t("form.save")}
          </Button>
        </div>
      </Card>
    </PageShell>
  );
}
