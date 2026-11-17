"use client";

// One sent mail: who it went to, what happened to it, and the mail itself. A page in the overlay, reached from the
// log here and from a member's page (docs/settings.md).
import { useState } from "react";
import { useTranslations } from "next-intl";

import { PageShell } from "@/components/page-shell";
import {
  SettingRow,
  SettingsCard,
  SettingsRows,
  SettingsStack,
} from "@/components/settings/settings-card";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tag } from "@/components/ui/status-pill";
import type { EmailLogRow } from "@/lib/data/emails";
import { useFormat } from "@/lib/ui/use-format";
import { STATUS_TONE } from "../email-log";

export function EmailClient({
  row,
  body,
}: {
  row: EmailLogRow;
  body: { subject: string; text: string; html: string | null };
}) {
  const t = useTranslations("admin.email");
  const tKind = useTranslations("profile.notifications.kind");
  const { dateTime } = useFormat();
  const { pending, mutate } = useMutation();
  const [view, setView] = useState<"html" | "text">("html");
  const shown = body.html ? view : "text";

  const retry = () =>
    mutate(`/api/emails/${row.id}/retry`, {
      key: "retry",
      success: t("retried"),
      error: t("retryFailed"),
    });

  const facts: [string, string][] = [
    [t("fact.to"), `${row.recipient.name} <${row.recipient.email}>`],
    [t("fact.kind"), tKind(row.kind)],
    [t("fact.created"), dateTime(row.createdAt)],
    [t("fact.sent"), row.sentAt ? dateTime(row.sentAt) : t("notSent")],
    [t("fact.attempts"), String(row.attempts)],
  ];
  if (row.sentBy) facts.push([t("fact.sentBy"), row.sentBy]);

  return (
    <PageShell
      title={row.subject}
      back="/admin/email"
      aside={
        <>
          <Tag tone={STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</Tag>
          {row.status !== "SENT" && (
            <Button size="sm" variant="secondary" loading={pending === "retry"} onClick={retry}>
              {t("retry")}
            </Button>
          )}
        </>
      }
    >
      <SettingsStack>
        {row.lastError && row.status !== "SENT" && (
          <Notice tone="danger">
            <span className="font-mono text-xs">{row.lastError}</span>
          </Notice>
        )}

        <SettingsCard title={t("factsTitle")}>
          <SettingsRows>
            {facts.map(([label, value]) => (
              <SettingRow key={label} label={label}>
                <span className="block break-words text-sm sm:text-right">{value}</span>
              </SettingRow>
            ))}
          </SettingsRows>
        </SettingsCard>

        <SettingsCard
          title={t("bodyTitle")}
          action={
            body.html && (
              <SegmentedControl
                size="sm"
                value={shown}
                onChange={setView}
                options={[
                  { value: "html", label: t("viewHtml") },
                  { value: "text", label: t("viewText") },
                ]}
              />
            )
          }
        >
          <div className="p-inset">
            {shown === "html" ? (
              // Sandboxed with nothing allowed: no scripts, no forms, no navigating the app from inside a mail.
              <iframe
                title={row.subject}
                sandbox=""
                srcDoc={body.html ?? ""}
                className="h-[60dvh] w-full rounded-panel border border-border bg-white"
              />
            ) : (
              <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded-panel border border-border bg-surface p-4 font-mono text-xs">
                {body.text}
              </pre>
            )}
          </div>
        </SettingsCard>
      </SettingsStack>
    </PageShell>
  );
}
