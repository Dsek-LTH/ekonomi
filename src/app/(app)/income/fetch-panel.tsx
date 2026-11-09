"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { DateInput, Field } from "@/components/ui/field";
import { useFiscalYear } from "@/components/shell/fiscal-year-context";
import { fiscalYearLabel, outsideFiscalYear } from "@/lib/ui/fiscal-year";

interface FetchResult {
  batchId: string;
  created: number;
  superseded: number;
  alreadyBooked: string[];
  alreadyInFortnox: string[];
  fortnoxChecked: boolean;
  fortnoxCheckSkipped: "notConnected" | "seriesUnset" | "failed" | null;
}

export type FetchSource = "ZETTLE" | "SWISH";

export function FetchPanel({
  source,
  ready,
  title,
  subtitle,
}: {
  source: FetchSource;
  ready: boolean;
  title: string;
  subtitle: string;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <FetchForm source={source} ready={ready} />
    </Card>
  );
}

/** The form in a dialog, from the list's header. Closes itself once a fetch has gone through. */
export function FetchDialog({
  source,
  ready,
  onClose,
}: {
  source: FetchSource;
  ready: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("income");
  return (
    <Modal
      label={t(source === "SWISH" ? "fetch.titleSwish" : "fetch.titleZettle")}
      onClose={onClose}
      className="max-w-xl"
    >
      <ModalHeader
        title={t(source === "SWISH" ? "fetch.titleSwish" : "fetch.titleZettle")}
        subtitle={t("fetch.description")}
      />
      <FetchForm source={source} ready={ready} onDone={onClose} onCancel={onClose} />
    </Modal>
  );
}

function FetchForm({
  source,
  ready,
  onDone,
  onCancel,
}: {
  source: FetchSource;
  ready: boolean;
  onDone?: () => void;
  /** In a dialog: the form is the dialog's body, with Avbryt beside the button in its footer. */
  onCancel?: () => void;
}) {
  const t = useTranslations("income");
  const tCommon = useTranslations("common");
  const fiscalYear = useFiscalYear();
  const notify = useNotify();
  const { pending, mutate } = useMutation();
  const fileRef = useRef<HTMLInputElement>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const busy = pending === "fetch";
  const rangeSet = Boolean(from && to);
  // Without the service there is nothing to import: said once by the page. The range is kept to the year picked in the header, as the routes keep it.
  const offYear = (d: string) =>
    outsideFiscalYear(fiscalYear, d)
      ? tCommon("dateOutsideFiscalYear", { year: fiscalYearLabel(fiscalYear!) })
      : undefined;
  const fromError = offYear(from);
  const toError = offYear(to);
  const canFetch = ready && rangeSet && !fromError && !toError && !busy;

  function report(result: FetchResult | null) {
    if (!result) return;
    onDone?.();
    const parts = [t("summary.imported", { count: result.created })];
    // Each is worth a line when it happened: a day that silently went missing looks like vanished takings.
    if (result.superseded > 0) {
      parts.push(t("summary.superseded", { count: result.superseded }));
    }
    if (result.alreadyBooked.length > 0) {
      parts.push(t("summary.alreadyBooked", { count: result.alreadyBooked.length }));
    }
    if (result.alreadyInFortnox.length > 0) {
      parts.push(t("summary.alreadyInFortnox", { count: result.alreadyInFortnox.length }));
    }
    // Only when the check was meant to run and could not (not being connected to Fortnox is normal).
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
        body: { from, to },
        error: t("fetchFailed"),
      }),
    );
  }

  async function uploadSwish(file: File) {
    const params = new URLSearchParams({ from, to, filename: file.name });
    const result = await mutate<FetchResult>(`/api/income/batches/swish?${params}`, {
      key: "fetch",
      // The CSV goes up as-is: it is ISO-8859-1 and the service decodes it (decoding here would mangle å, ä, ö).
      body: file,
      contentType: "text/csv",
      error: t("fetchFailed"),
    });
    if (fileRef.current) fileRef.current.value = "";
    report(result);
  }

  const fields = (
    <>
      <div className="w-40">
        <Field label={t("fetch.from")} requirement="required" error={fromError}>
          <DateInput
            min={fiscalYear?.fromDate}
            max={fiscalYear?.toDate}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
      </div>
      <div className="w-40">
        <Field label={t("fetch.to")} requirement="required" error={toError}>
          <DateInput
            min={fiscalYear?.fromDate}
            max={fiscalYear?.toDate}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
    </>
  );

  const submit =
    source === "SWISH" ? (
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
    );

  if (onCancel) {
    return (
      <>
        <ModalBody>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-5">{fields}</div>
        </ModalBody>
        <ModalFooter blocker={ready ? null : t("fetch.notReady")}>
          <span />
          <div className="flex items-center gap-2.5">
            <Button variant="secondary" onClick={onCancel}>
              {tCommon("cancel")}
            </Button>
            {submit}
          </div>
        </ModalFooter>
      </>
    );
  }

  return (
    // One row on a laptop, wrapping on a narrow window; bottom-aligned so the labels sit above a single line of controls.
    <CardBody className="flex flex-wrap items-end gap-x-4 gap-y-5">
      {fields}
      {submit}
    </CardBody>
  );
}
