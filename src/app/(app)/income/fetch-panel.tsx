"use client";

// Fetching a range: the three sources, the two dates, and the button.
//
// Two ways onto the screen, the same form in both. While there is nothing to
// book it is the page (FetchPanel), because fetching is then the only thing
// to do. Once there is, it is a dialog (FetchDialog) opened from the list's
// own header: importing happens a few times a term and reading every day, so
// the form stays out of the way until asked for, and opening it moves nothing
// on the page. It used to be a card unfolded under a button on a toolbar row
// of its own, which stood alone above the list and pushed it down.
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { Combobox } from "@/components/ui/combobox";
import { DateInput, Field, FieldGroup } from "@/components/ui/field";
import type { IncomeSource } from "@/lib/domain/types";

/** What a fetch answers with. See api/income/batches. */
interface FetchResult {
  batchId: string;
  created: number;
  /** Drafts of the same days, from an earlier fetch, that this one replaced. */
  superseded: number;
  alreadyBooked: string[];
  /** Days Fortnox already had a voucher for, which were not imported at all. */
  alreadyInFortnox: string[];
  fortnoxChecked: boolean;
  fortnoxCheckSkipped: "notConnected" | "seriesUnset" | "failed" | null;
}

const SOURCES: IncomeSource[] = ["SWISH", "ZETTLE", "ZETTLE_FEE"];

/** The form inside a card, as the page, for when there is nothing to book. */
export function FetchPanel({
  serviceConfigured,
  title,
  subtitle,
}: {
  serviceConfigured: boolean;
  title: string;
  subtitle: string;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <FetchForm serviceConfigured={serviceConfigured} />
    </Card>
  );
}

/** The form in a dialog, from the list's header. Closes itself once a fetch
 *  has gone through, since what it fetched is then on the list behind it. */
export function FetchDialog({
  serviceConfigured,
  onClose,
}: {
  serviceConfigured: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("income");
  return (
    <Modal label={t("fetch.title")} onClose={onClose} className="max-w-2xl">
      <ModalHeader title={t("fetch.title")} subtitle={t("fetch.description")} />
      <FetchForm serviceConfigured={serviceConfigured} onDone={onClose} />
    </Modal>
  );
}

function FetchForm({
  serviceConfigured,
  onDone,
}: {
  serviceConfigured: boolean;
  /** After a fetch that went through. */
  onDone?: () => void;
}) {
  const t = useTranslations("income");
  const notify = useNotify();
  const { pending, mutate } = useMutation();
  const fileRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<IncomeSource>("SWISH");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const busy = pending === "fetch";
  const rangeSet = Boolean(from && to);
  // The service is what reaches Zettle and renders; without it there is nothing
  // to import. Said once, by the page, rather than as a failure on every button.
  const canFetch = serviceConfigured && rangeSet && !busy;

  function report(result: FetchResult | null) {
    if (!result) return;
    onDone?.();
    const parts = [t("summary.imported", { count: result.created })];
    // Each of these is only worth a line when it happened, but always worth
    // one then: a day that silently went missing looks like takings that
    // vanished, and one that was quietly replaced looks like an import that
    // did nothing.
    if (result.superseded > 0) {
      parts.push(t("summary.superseded", { count: result.superseded }));
    }
    if (result.alreadyBooked.length > 0) {
      parts.push(t("summary.alreadyBooked", { count: result.alreadyBooked.length }));
    }
    if (result.alreadyInFortnox.length > 0) {
      parts.push(t("summary.alreadyInFortnox", { count: result.alreadyInFortnox.length }));
    }
    // Only when the check was meant to run and could not. Not being connected
    // to Fortnox at all is a way this app is run, not news.
    if (result.fortnoxCheckSkipped === "failed") parts.push(t("summary.fortnoxCheckFailed"));
    // Connected, but with no series chosen there was nowhere to look.
    if (result.fortnoxCheckSkipped === "seriesUnset") {
      parts.push(t("summary.fortnoxCheckSeriesUnset"));
    }
    notify.success(parts.join(" - "), t("fetchDone"));
  }

  async function fetchRange() {
    report(
      await mutate<FetchResult>("/api/income/batches", {
        key: "fetch",
        body: { source, from, to },
        error: t("fetchFailed"),
      }),
    );
  }

  async function uploadSwish(file: File) {
    const params = new URLSearchParams({ from, to, filename: file.name });
    const result = await mutate<FetchResult>(`/api/income/batches/swish?${params}`, {
      key: "fetch",
      // The CSV goes up as-is. It is ISO-8859-1, and the service is what knows
      // that. Decoding it here would mangle every å, ä and ö in a message.
      body: file,
      contentType: "text/csv",
      error: t("fetchFailed"),
    });
    if (fileRef.current) fileRef.current.value = "";
    report(result);
  }

  return (
    <>
      {/* One row on a laptop, wrapping on a narrow window: the four controls
          are one sentence: this source, these dates, go. Bottom-aligned, so
          the labels sit above a single line of controls rather than each field
          floating at its own height. A wider gap down the page than across it:
          when the row does wrap, the labels need clearing from the controls
          above them. */}
      <CardBody className="flex flex-wrap items-end gap-x-4 gap-y-5">
        {/* A FieldGroup rather than a Field: the picker's trigger is a button,
            and a <label> forwards a click anywhere in its box to the first
            labelable element inside, so the label's own whitespace would pop
            the menu open. See components/ui/field.tsx. */}
        <div className="w-48">
          <FieldGroup label={t("fetch.source")} requirement="required">
            <Combobox
              options={SOURCES.map((s) => ({ value: s, label: t(`source.${s}`) }))}
              value={source}
              onChange={(v) => setSource(v as IncomeSource)}
              aria-label={t("fetch.source")}
            />
          </FieldGroup>
        </div>
        {/* Sized on a wrapper rather than on the control: every field in the
            app is `w-full` inside whatever holds it (see `control` in
            components/ui/field.tsx), and `cn` joins classes rather than merging
            them, a `w-40` passed to the input would leave both widths in the
            class attribute for Tailwind's emission order to settle.

            Ten characters wide, because that is what the mask allows and a
            field that grew with the row would be mostly empty. Both the same,
            because they are the two ends of one range. */}
        <div className="w-40">
          <Field label={t("fetch.from")} requirement="required">
            <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label={t("fetch.to")} requirement="required">
            <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {source === "SWISH" ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadSwish(file);
              }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={!canFetch} loading={busy}>
              {t("fetch.chooseFile")}
            </Button>
          </>
        ) : (
          <Button onClick={fetchRange} disabled={!canFetch} loading={busy}>
            {t("fetch.submit")}
          </Button>
        )}
      </CardBody>
    </>
  );
}
