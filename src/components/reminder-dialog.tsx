"use client";

// Remind whoever some things are waiting on: an utlägg from its own page, or
// several picked on a list, utlägg or card purchases with no utlägg yet.
//
// It asks the server who a reminder would reach before offering to send it,
// and says so: "Maja Holm" under each utlägg, and which of the picked ones
// will not be reminded about and why. Sending somebody a mail on your behalf
// is the one thing here you cannot take back, so the names are on screen
// before the button is. See lib/server/reminders.ts.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { useMutation } from "@/components/shell/use-mutation";
import { useQuery } from "@/components/shell/use-query";
import type { ReminderPreview } from "@/lib/domain/reminders";

export function ReminderDialog({
  expenseIds = [],
  transactionIds = [],
  onClose,
  onSent,
}: {
  expenseIds?: readonly string[];
  transactionIds?: readonly string[];
  onClose: () => void;
  /** After a send went through. The dialog has already closed by then. */
  onSent?: () => void;
}) {
  const t = useTranslations("expenses.reminders");
  const tCommon = useTranslations("common");
  const { pending, mutate } = useMutation();
  const [message, setMessage] = useState("");
  const query = new URLSearchParams();
  if (expenseIds.length) query.set("expenses", expenseIds.join(","));
  if (transactionIds.length) query.set("transactions", transactionIds.join(","));
  const { data, error } = useQuery<ReminderPreview>(`/api/reminders?${query}`);

  // Each person once, however many of the picked utlägg wait on them: that is
  // how many mails go out.
  const people = new Set(data?.items.flatMap((i) => i.recipients.map((r) => r.id)) ?? []).size;
  const picked = expenseIds.length + transactionIds.length;

  const send = async () => {
    const ok = await mutate("/api/reminders", {
      key: "send",
      body: { expenseIds, transactionIds, message },
      success: t("sent", { count: people }),
      error: t("sendFailed"),
    });
    if (ok) {
      onClose();
      onSent?.();
    }
  };

  return (
    <Modal label={t("title")} onClose={onClose} className="sm:max-w-lg">
      <ModalHeader
        title={t("title")}
        subtitle={picked === 1 ? undefined : t("subtitleMany", { count: picked })}
      />
      <ModalBody>
        {error && <Notice tone="danger">{error}</Notice>}
        {!data && !error && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" />
            {t("loading")}
          </p>
        )}

        {data && data.items.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("goesTo")}</p>
            <ul className="divide-y divide-border rounded-panel border border-border">
              {data.items.map((i) => (
                <li key={i.id} className="px-3 py-2">
                  <p className="truncate text-sm">{i.label}</p>
                  <p className="text-xs text-muted">
                    {t(`target.${i.target}`)}
                    {": "}
                    {i.recipients.map((r) => r.name).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data && data.skipped.length > 0 && (
          <Notice tone={data.items.length ? "info" : "warning"}>
            <p>{t("skippedTitle", { count: data.skipped.length })}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {data.skipped.map((s) => (
                <li key={s.id}>
                  {s.label}: {t(`skipped.${s.reason}`)}
                </li>
              ))}
            </ul>
          </Notice>
        )}

        {data && data.items.length > 0 && (
          <Field label={t("message")} hint={t("messageHint")}>
            <Textarea
              value={message}
              maxLength={2000}
              placeholder={t("messagePlaceholder")}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {tCommon("cancel")}
        </Button>
        <Button loading={pending === "send"} disabled={!data || people === 0} onClick={send}>
          {people > 0 ? t("send", { count: people }) : t("sendNone")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
