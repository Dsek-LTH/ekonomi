"use client";

// The outbox, read as a log: every mail the app has written, newest first,
// with where each one got to. Opening a row shows the mail as it was sent.
//
// Two places draw it. Inställningar → E-post shows the whole log, searchable.
// The person dialog under Användare shows one member's, with a way to send
// them a test mail above it: "did they get it" and "send them one and see" are
// the same visit. See lib/data/emails.ts for the reading side.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { IconButton } from "@/components/ui/icon-button";
import { IconX } from "@/components/ui/icons";
import { Modal, ModalBody, ModalFooter } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { Tag } from "@/components/ui/status-pill";
import { useMutation } from "@/components/shell/use-mutation";
import { useQuery } from "@/components/shell/use-query";
import { ALL_KINDS } from "@/lib/domain/notifications";
import type { NotificationKind } from "@/lib/domain/types";
import type { EmailFilter, EmailLogPage, EmailLogRow, EmailStatus } from "@/lib/data/emails";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";

// Mirrors EMAIL_LOG_PAGE in lib/data/emails.ts, which is server-only.
const PAGE = 50;

const STATUS_TONE: Record<EmailStatus, "success" | "neutral" | "warning" | "danger"> = {
  SENT: "success",
  QUEUED: "neutral",
  RETRYING: "warning",
  FAILED: "danger",
};

export function EmailLog({
  recipient,
}: {
  /** One member's mail, with the test form above it. Absent for the whole log. */
  recipient?: { id: string; name: string };
}) {
  const t = useTranslations("admin.email");
  const [filter, setFilter] = useState<EmailFilter>("");
  const [q, setQ] = useState("");
  const [take, setTake] = useState(PAGE);
  const [open, setOpen] = useState<EmailLogRow | null>(null);

  const params = new URLSearchParams();
  if (recipient) params.set("recipient", recipient.id);
  if (filter) params.set("filter", filter);
  if (q.trim()) params.set("q", q.trim());
  params.set("take", String(take));
  const { data, error, loading, reload } = useQuery<EmailLogPage>(`/api/emails?${params}`, {
    debounceMs: q ? 250 : 0,
  });

  // A narrower question starts from the top again.
  const narrow = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setTake(PAGE);
  };

  return (
    <div className="space-y-3">
      {recipient && <TestEmailForm recipient={recipient} onSent={reload} />}

      {data && !data.mailEnabled && <Notice tone="info">{t("mailOff")}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs<EmailFilter>
          aria-label={t("filterLabel")}
          value={filter}
          onChange={narrow(setFilter)}
          options={[
            { value: "", label: t("filter.all") },
            { value: "sent", label: t("filter.sent") },
            { value: "unsent", label: t("filter.unsent") },
            { value: "failed", label: t("filter.failed") },
          ]}
        />
        {!recipient && (
          <SearchInput
            value={q}
            onChange={(e) => narrow(setQ)(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full sm:w-72"
          />
        )}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {!data && !error && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" />
          {t("loading")}
        </p>
      )}

      {data && data.rows.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">
          {filter || q ? t("noMatch") : recipient ? t("emptyPerson") : t("empty")}
        </p>
      )}

      {data && data.rows.length > 0 && (
        <ul className={cn("divide-y divide-border rounded-panel border border-border", loading && "opacity-70")}>
          {data.rows.map((row) => (
            <li key={row.id}>
              <LogRow row={row} showRecipient={!recipient} onOpen={() => setOpen(row)} />
            </li>
          ))}
        </ul>
      )}

      {data?.more && (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" loading={loading} onClick={() => setTake(take + PAGE)}>
            {t("loadMore")}
          </Button>
        </div>
      )}

      {open && (
        <EmailDialog
          key={open.id}
          // The row as the latest reload has it, so a retry shows its outcome.
          row={data?.rows.find((r) => r.id === open.id) ?? open}
          onClose={() => setOpen(null)}
          onRetried={reload}
        />
      )}
    </div>
  );
}

function LogRow({
  row,
  showRecipient,
  onOpen,
}: {
  row: EmailLogRow;
  showRecipient: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("admin.email");
  const tKind = useTranslations("profile.notifications.kind");
  const { dateTime } = useFormat();

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{row.subject}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {[showRecipient ? row.recipient.name : null, tKind(row.kind), dateTime(row.createdAt)]
            .filter(Boolean)
            .join(" – ")}
        </span>
        {row.lastError && row.status !== "SENT" && (
          <span className="mt-1 block truncate font-mono text-xs text-danger">{row.lastError}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {row.sentBy && (
          <Tag size="sm" tone="purple" title={t("sentBy", { name: row.sentBy })}>
            {t("test")}
          </Tag>
        )}
        <Tag size="sm" tone={STATUS_TONE[row.status]}>
          {t(`status.${row.status}`)}
        </Tag>
      </span>
    </button>
  );
}

/** One mail as it was written, with what became of it and a retry if unsent. */
function EmailDialog({
  row,
  onClose,
  onRetried,
}: {
  row: EmailLogRow;
  onClose: () => void;
  onRetried: () => void;
}) {
  const t = useTranslations("admin.email");
  const tCommon = useTranslations("common");
  const tKind = useTranslations("profile.notifications.kind");
  const { dateTime } = useFormat();
  const { pending, mutate } = useMutation();
  const [view, setView] = useState<"html" | "text">("html");
  const { data, error } = useQuery<{ subject: string; text: string; html: string | null }>(
    `/api/emails/${row.id}`,
  );
  // A mail written before HTML existed has only its text.
  const shown = data && !data.html ? "text" : view;

  const retry = async () => {
    const ok = await mutate(`/api/emails/${row.id}/retry`, {
      key: "retry",
      success: t("retried"),
      error: t("retryFailed"),
      refresh: false,
    });
    if (ok) {
      onRetried();
      // The send runs after the response; ask again once it has had a moment.
      setTimeout(onRetried, 3000);
    }
  };

  const facts: [string, string][] = [
    [t("fact.to"), `${row.recipient.name} <${row.recipient.email}>`],
    [t("fact.kind"), tKind(row.kind)],
    [t("fact.created"), dateTime(row.createdAt)],
    [t("fact.sent"), row.sentAt ? dateTime(row.sentAt) : t("notSent")],
    [t("fact.attempts"), String(row.attempts)],
  ];
  if (row.sentBy) facts.push([t("fact.sentBy"), row.sentBy]);

  return (
    <Modal label={row.subject} onClose={onClose} className="sm:max-w-3xl">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-inset py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{row.subject}</h2>
        </div>
        <Tag size="sm" tone={STATUS_TONE[row.status]}>
          {t(`status.${row.status}`)}
        </Tag>
        <IconButton label={tCommon("close")} onClick={onClose}>
          <IconX className="size-4" />
        </IconButton>
      </div>

      <ModalBody>
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {row.lastError && row.status !== "SENT" && (
          <Notice tone="danger">
            <span className="font-mono text-xs">{row.lastError}</span>
          </Notice>
        )}

        {data?.html && (
          <SegmentedControl
            size="sm"
            value={shown}
            onChange={setView}
            options={[
              { value: "html", label: t("viewHtml") },
              { value: "text", label: t("viewText") },
            ]}
          />
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {!data && !error && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" />
            {t("loading")}
          </p>
        )}
        {data &&
          (shown === "html" ? (
            // Sandboxed with nothing allowed: no scripts, no forms, no
            // navigating the app from inside a mail. The mail is ours, but it
            // carries text members wrote, and the frame has no need to trust it.
            <iframe
              title={row.subject}
              sandbox=""
              srcDoc={data.html ?? ""}
              className="h-[60dvh] w-full rounded-panel border border-border bg-white"
            />
          ) : (
            <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded-panel border border-border bg-surface p-4 font-mono text-xs">
              {data.text}
            </pre>
          ))}
      </ModalBody>

      {row.status !== "SENT" && (
        <ModalFooter>
          <p className="text-xs text-muted">{t("retryHint")}</p>
          <Button variant="secondary" loading={pending === "retry"} onClick={retry}>
            {t("retry")}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
}

/** Send one member a made-up mail of any kind, marked as a test. */
function TestEmailForm({
  recipient,
  onSent,
}: {
  recipient: { id: string; name: string };
  onSent: () => void;
}) {
  const t = useTranslations("admin.email");
  const tKind = useTranslations("profile.notifications.kind");
  const { pending, mutate } = useMutation();
  const [kind, setKind] = useState<NotificationKind>("EXPENSE_SUBMITTED");

  const send = async () => {
    const ok = await mutate(`/api/users/${recipient.id}/test-email`, {
      key: "test",
      body: { kind },
      success: t("testSent", { name: recipient.name }),
      error: t("testFailed"),
      refresh: false,
    });
    if (ok) {
      onSent();
      // The mail goes out after the response; ask again once it has had a
      // moment, so the row turns from queued to sent (or failed) on its own.
      setTimeout(onSent, 3000);
    }
  };

  return (
    <div className="space-y-2 rounded-panel border border-border p-4">
      <div>
        <h3 className="text-sm font-semibold">{t("testTitle")}</h3>
        <p className="mt-0.5 text-xs text-muted">{t("testHint")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Combobox
          value={kind}
          onChange={(v) => setKind(v as NotificationKind)}
          options={ALL_KINDS.map((k) => ({ value: k, label: tKind(k) }))}
          className="min-w-0 flex-1"
        />
        <Button loading={pending === "test"} onClick={send}>
          {t("testSend")}
        </Button>
      </div>
    </div>
  );
}
