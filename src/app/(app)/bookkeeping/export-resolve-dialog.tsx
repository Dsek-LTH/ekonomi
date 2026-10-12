"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useMutation } from "@/components/shell/use-mutation";
import type { ResolveExport } from "@/lib/api/schemas/expense";

type Outcome = ResolveExport["outcome"];

/**
 * Say what Fortnox actually holds for an export that ended without an answer.
 *
 * The person has looked, and the app has not been able to. So the dialog asks
 * the question the way they found the answer: is the voucher there or not.
 * Either answer lets go of the lock. "It is there" records the export with the
 * number they read off it. "It is not" makes the utlägg exportable again, which
 * is the answer that files it twice if it is wrong, so it asks how they know.
 */
export function ExportResolveDialog({
  expenseId,
  label,
  by,
  onClose,
  onResolved,
}: {
  expenseId: string;
  /** The utlägg's reference, for the heading. */
  label: string;
  /** Whose export it was. Null if they have since been removed. */
  by: string | null;
  onClose: () => void;
  onResolved: () => void;
}) {
  const t = useTranslations("bookkeeping.resolve");
  const { busy, mutate } = useMutation();
  const [outcome, setOutcome] = useState<Outcome>("exists");
  const [series, setSeries] = useState("");
  const [number, setNumber] = useState("");
  const [comment, setComment] = useState("");

  const parsedNumber = Number(number.trim());
  const blocker =
    outcome === "exists"
      ? !series.trim() || !Number.isInteger(parsedNumber) || parsedNumber <= 0
        ? t("voucherRequired")
        : null
      : !comment.trim()
        ? t("reasonRequired")
        : null;

  async function submit() {
    const body: ResolveExport =
      outcome === "exists"
        ? { outcome, series: series.trim(), number: parsedNumber, comment: comment.trim() || undefined }
        : { outcome, comment: comment.trim() };
    const done = await mutate(`/api/expenses/${expenseId}/export/resolve`, {
      body,
      error: t("failed"),
      success: outcome === "exists" ? t("markedExported") : t("released"),
    });
    if (done) onResolved();
  }

  return (
    <Modal label={t("title", { id: label })} onClose={onClose} className="sm:max-w-lg">
      <ModalHeader title={t("title", { id: label })} />
      <ModalBody>
        <Notice>{by ? t("explain", { name: by }) : t("explainUnknown")}</Notice>
        <SegmentedControl<Outcome>
          options={[
            { value: "exists", label: t("exists") },
            { value: "none", label: t("none") },
          ]}
          value={outcome}
          onChange={setOutcome}
        />
        {outcome === "exists" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("series")} requirement="required">
                <Input value={series} onChange={(e) => setSeries(e.target.value)} placeholder="A" />
              </Field>
              <Field label={t("number")} requirement="required">
                <Input
                  inputMode="numeric"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="123"
                />
              </Field>
            </div>
            <Field label={t("comment")} requirement="optional">
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Notice tone="danger">{t("noneWarning")}</Notice>
            <Field label={t("reason")} requirement="required">
              <Textarea
                rows={3}
                value={comment}
                placeholder={t("reasonPlaceholder")}
                onChange={(e) => setComment(e.target.value)}
              />
            </Field>
          </>
        )}
      </ModalBody>
      <ModalFooter blocker={blocker}>
        <span />
        <div className="flex gap-2.5">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            variant={outcome === "none" ? "danger" : "primary"}
            loading={busy}
            disabled={blocker !== null}
            onClick={submit}
          >
            {outcome === "exists" ? t("markExported") : t("release")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
