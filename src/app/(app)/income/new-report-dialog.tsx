"use client";

// "Ny rapport": a day for a verksamhet the fetch never made one for.
//
// The case it exists for is the one the move dialog beside it cannot reach. A
// sale rung up without its prefix routes to the fallback (Skattmästeriet) and
// moving it out lands it on the destination's report for that day, which
// `moveIncomeLines` creates if there is none. That covers a stray or two. It
// does not cover a day where *nothing* was rung up properly: two verksamheter
// sell all evening, every product falls to the fallback, and the whole day is
// one report belonging to neither of them. Splitting that in two means one of
// the halves needs somewhere to go that does not exist yet, and this makes it.
//
// One question, because there is only one. The day is the group in the queue the
// button was pressed on, and the payment method is whatever that day's takings
// came in as. A fetch clears the unbooked working set before storing what it
// brought back, so the queue is one fetch and one source, and asking which would
// be asking someone to read it off the screen and type it back in. Whose takings
// they are is the part nobody can work out for you, so it starts empty.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { FieldGroup } from "@/components/ui/field";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import type { IncomeMoveTarget, IncomeReportRow } from "@/lib/data/income";

/** Zettle or Swish. Never ZETTLE_FEE, see lib/income/draft.ts. */
export type NewReportSource = "ZETTLE" | "SWISH";

export interface NewReportRequest {
  source: NewReportSource;
  date: string;
  resultUnitId: string;
}

export function NewReportDialog({
  targets,
  reports,
  date,
  source,
  /** The day as it is written on screen, for the subtitle. */
  dateLabel,
  busy,
  onCancel,
  onCreate,
}: {
  /** Every verksamhet still taking money in. */
  targets: IncomeMoveTarget[];
  /** The queue, to say when the day asked for is already in it. */
  reports: IncomeReportRow[];
  date: string;
  source: NewReportSource;
  dateLabel: string;
  busy: boolean;
  onCancel: () => void;
  onCreate: (request: NewReportRequest) => void;
}) {
  const t = useTranslations("income.newReport");
  const tSource = useTranslations("income.source");

  const [resultUnitId, setResultUnitId] = useState("");

  const unitOptions: ComboOption[] = targets.map((u) => ({ value: u.resultUnitId, label: u.name }));

  // The verksamhet's report for exactly this source and day, if the queue
  // already holds one. Said before anything is pressed rather than after: the
  // route hands back the existing report instead of making a second: two
  // drafts for one day are two reports of which only one could ever be booked,
  // and a button that quietly does something other than what it says is worse
  // than one that says what it is about to do.
  const existing = resultUnitId
    ? reports.find((r) => r.date === date && r.source === source && r.resultUnitId === resultUnitId)
    : undefined;

  return (
    <Modal label={t("title")} onClose={onCancel} className="max-w-md">
      <ModalHeader
        title={t("title")}
        subtitle={t("subtitle", { date: dateLabel, source: tSource(source) })}
      />

      <ModalBody>
        <FieldGroup label={t("unit")} hint={t("unitHint")}>
          <Combobox
            options={unitOptions}
            value={resultUnitId}
            onChange={setResultUnitId}
            placeholder={t("unitPlaceholder")}
            aria-label={t("unit")}
          />
        </FieldGroup>

        {existing && <Notice tone="info">{t("alreadyExists")}</Notice>}
      </ModalBody>

      <ModalFooter>
        <span className="text-sm text-muted">{t("footerHint")}</span>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            loading={busy}
            disabled={!resultUnitId}
            onClick={() => resultUnitId && onCreate({ source, date, resultUnitId })}
          >
            {existing ? t("open") : t("confirm")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
